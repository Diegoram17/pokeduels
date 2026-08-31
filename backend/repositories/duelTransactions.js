/**
 * Duel write operations (Phase 3, A2 split). Every function that mutates duel
 * state lives here — single-UPDATE writes straight on the shared pool, plus
 * the three transactional writes (applyRoundResult, createDuelFromRoom,
 * applySwitchDecision) rewritten on top of `withTransaction`. SQL text is
 * byte-identical to the pre-split monolithic duelRepository.js.
 *
 * The barrel (../repositories/duelRepository.js) re-exports the public names;
 * `withTransaction` / `insertMove` / `INSERT_MOVE_SQL` / `moveParams` are
 * module-level helpers NOT part of the barrel's public API.
 */
import { pool } from '../db/pool.js';
import { validateSwitchDecision, validateLeadSelection } from '../engine/switchValidation.js';

export const INSERT_MOVE_SQL = `
  INSERT INTO moves
    (duel_id, turn_number, player_id, action_type, pokemon_id,
     move_index, target_pokemon_id, damage_dealt, effectiveness, was_timeout)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`;

export function moveParams(row) {
  return [
    row.duel_id,
    row.turn_number,
    row.player_id,
    row.action_type,
    row.pokemon_id,
    row.move_index,
    row.target_pokemon_id,
    row.damage_dealt ?? null,
    row.effectiveness ?? null,
    Boolean(row.was_timeout),
  ];
}

/**
 * Shared transaction wrapper (A2). Runs BEGIN -> fn(client) -> COMMIT; on any
 * throw it runs ROLLBACK (a ROLLBACK failure is swallowed), then releases the
 * client in `finally`, then rethrows the original error. The three
 * transactional writes run their bodies inside this so the BEGIN/COMMIT/
 * ROLLBACK/release plumbing is written once, not three times.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Conditionally finishes a duel (item #6 centralized finish path). The UPDATE
 * only affects a row whose status is still `in_progress`, so a repeat finish
 * (stray timer, simultaneous surrender/disconnect) is a silent no-op — the
 * atomic conditional is the simultaneous-finish tie-break: whichever write
 * actually transitions the row wins, the loser affects 0 rows.
 *
 * Only `duels.status/winner_id/end_reason` are written — never `rooms.status`
 * or `room_players` (bracket-advance is item #7's job).
 *
 * @param {number} duelId
 * @param {number} winnerId
 * @param {'ko'|'surrender'|'disconnect'|'server_restart'} endReason
 * @returns {Promise<{ applied: boolean }>} applied=false when 0 rows changed
 *          (already finished or no such duel)
 */
export async function finishDuelWrite(duelId, winnerId, endReason) {
  const { rowCount } = await pool.query(
    `UPDATE duels
     SET status = 'finished', winner_id = $2, end_reason = $3
     WHERE id = $1 AND status IN ('pending', 'in_progress')`,
    [duelId, winnerId, endReason],
  );
  return { applied: rowCount > 0 };
}

/**
 * Marks a duel as live (item #6 foundation). `createDuelFromRoom` inserts
 * duels with status 'pending'; the WS layer advances the in-memory engine FSM
 * to `in_progress` when both leads are picked. This write keeps the coarse
 * `duels.status` column in sync with that moment — the status the item-#6
 * in_progress-guarded operations (finishDuelWrite, findActiveDuelForPlayer,
 * resolverRonda guard) depend on. Conditional on 'pending' so a live duel is
 * never re-marked and a finished duel is never re-opened.
 *
 * @param {number} duelId
 * @returns {Promise<{ applied: boolean }>} applied=false when the duel was
 *          not 'pending' (already in_progress, finished, or missing)
 */
export async function markDuelInProgress(duelId) {
  const { rowCount } = await pool.query(
    `UPDATE duels SET status = 'in_progress'
     WHERE id = $1 AND status = 'pending'`,
    [duelId],
  );
  return { applied: rowCount > 0 };
}

/**
 * Finishes a duel by walkover (item #7, bracket-walkover): the absent player
 * between bracket rounds is defaulted to a loss, crediting the opponent. This
 * is a SEPARATE write from finishDuelWrite because a between-round walkover
 * often targets a 'pending' duel (created but never started), while
 * finishDuelWrite is guarded to 'in_progress' only. The UPDATE affects rows in
 * EITHER 'pending' or 'in_progress', so the same conditional-tie-break applies:
 * a repeat walkover or a walkover racing another finish is a silent no-op
 * (0 rows changed -> applied:false).
 *
 * @param {number} duelId
 * @param {number} winnerId - the opponent credited with the walkover win
 * @returns {Promise<{ applied: boolean }>} applied=false when 0 rows changed
 *          (already finished, or no such duel)
 */
export async function finishDuelByWalkover(duelId, winnerId) {
  const { rowCount } = await pool.query(
    `UPDATE duels SET status = 'finished', winner_id = $2, end_reason = 'walkover'
     WHERE id = $1 AND status IN ('pending','in_progress')`,
    [duelId, winnerId],
  );
  return { applied: rowCount > 0 };
}

/**
 * Atomically commits one resolved round: UPDATE duels (status/winner/end_reason),
 * UPDATE every duel_pokemon_state row, INSERT every moveRow — all in ONE
 * transaction. Any failure rolls everything back (no partial rounds).
 *
 * @param {number} duelId
 * @param {{ duel: object, pokemonStates: object[] }} nextDuelState - post-round state
 * @param {object[]} moveRows - one audit row per executed/skipped action
 */
export async function applyRoundResult(duelId, nextDuelState, moveRows) {
  return withTransaction(async (client) => {
    const { duel, pokemonStates } = nextDuelState;
    await client.query(
      `UPDATE duels SET status = $1, winner_id = $2, end_reason = $3 WHERE id = $4`,
      [duel.status, duel.winner_id ?? null, duel.end_reason ?? null, duelId],
    );

    for (const p of pokemonStates) {
      await client.query(
        `UPDATE duel_pokemon_state
         SET current_hp = $1, pp_move_1 = $2, pp_move_2 = $3, pp_move_3 = $4,
             is_active = $5, fainted = $6
         WHERE id = $7`,
        [p.current_hp, p.pp_move_1, p.pp_move_2, p.pp_move_3, p.is_active, p.fainted, p.id],
      );
    }

    for (const row of moveRows) {
      await insertMove(client, row);
    }
  });
}

/**
 * Inserts a single moves audit row (used by applyRoundResult inside the round
 * transaction, and exposed for item #5 to journal switch actions).
 *
 * @param {object} moveRow - see moveParams for the column mapping
 */
export async function recordMove(moveRow) {
  await insertMove(pool, moveRow);
}

export async function insertMove(db, row) {
  await db.query(INSERT_MOVE_SQL, moveParams(row));
}

/**
 * Bootstraps a duel from a ready 1v1 room (item #5, "room-ready duel
 * creation"). One transaction: INSERT the duels row (status 'pending'), seed
 * every duel_pokemon_state row from the room's team_selections (full HP/PP,
 * inactive, alive — the first activation happens later via activateLead), and
 * advance rooms.status to 'in_progress'.
 *
 * Idempotent: a room that already has a duel returns the existing duel
 * without inserting a second row (a repeat room:ready must never
 * double-create). The room row is locked FOR UPDATE so two concurrent
 * bootstraps (both players ready nearly simultaneously) serialize: the second
 * transaction sees the first's committed duels row and returns it.
 *
 * Explicit pairing args (not room-order-only) so the bracket generator (#7)
 * can reuse it directly for semifinal/final/tercer_puesto.
 *
 * @param {number} roomId
 * @param {number} player1Id
 * @param {number} player2Id
 * @param {'unica'|'semifinal'|'final'|'tercer_puesto'} [round='unica']
 * @returns {Promise<{ id: number, status: string }>} the duel row
 */
export async function createDuelFromRoom(roomId, player1Id, player2Id, round = 'unica') {
  return withTransaction(async (client) => {
    // Serialize concurrent bootstraps on the room row (mirrors joinRoom's
    // FOR UPDATE pattern): the second transaction blocks here until the first
    // commits, then its existing-duel check below sees the committed row.
    await client.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);

    // Existing-duel check scoped by room + round + player pair + ACTIVE status
    // (item #7, PR 1 rematch): a repeat call for the same pair/round returns
    // the in-flight duel (idempotency), but a FINISHED duel no longer matches,
    // so a rematch creates a second duel row in the same room. Scoping by the
    // exact player pair (order-agnostic) also lets two different pairs share a
    // room+round — the 4-player bracket's two semifinals — without colliding.
    const { rows: existing } = await client.query(
      `SELECT id, status FROM duels
       WHERE room_id = $1 AND round = $4 AND status IN ('pending','in_progress')
         AND ((player1_id = $2 AND player2_id = $3)
           OR (player1_id = $3 AND player2_id = $2))`,
      [roomId, player1Id, player2Id, round],
    );
    if (existing[0]) {
      return existing[0];
    }

    const { rows: duelRows } = await client.query(
      `INSERT INTO duels (room_id, player1_id, player2_id, round, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id, status`,
      [roomId, player1Id, player2Id, round],
    );
    const duel = duelRows[0];

    await client.query(
      `INSERT INTO duel_pokemon_state
         (duel_id, player_id, pokemon_id, current_hp, pp_move_1, pp_move_2, pp_move_3, is_active, fainted)
       SELECT $1, player_id, pokemon_id, 100, 4, 4, 4, FALSE, FALSE
       FROM team_selections
       WHERE room_id = $2 AND player_id IN ($3, $4)`,
      [duel.id, roomId, player1Id, player2Id],
    );

    await client.query(
      "UPDATE rooms SET status = 'in_progress' WHERE id = $1",
      [roomId],
    );

    return duel;
  });
}

/**
 * Activates a player's first lead pokemon (pre-round setup, NOT an audited
 * switch — no moves row). Validates ownership + not-fainted via
 * validateLeadSelection; deliberately no `already_active` check (nothing is
 * active on the first pick).
 *
 * @param {number} duelId
 * @param {number} playerId
 * @param {number} pokemonId
 * @returns {Promise<object>} the updated duel_pokemon_state row
 * @throws {ValidationError} reason 'wrong_owner' | 'fainted'
 */
export async function activateLead(duelId, playerId, pokemonId) {
  await validateLeadSelection(duelId, playerId, pokemonId);
  const { rows } = await pool.query(
    `UPDATE duel_pokemon_state SET is_active = TRUE
     WHERE duel_id = $1 AND player_id = $2 AND pokemon_id = $3
     RETURNING id, duel_id, player_id, pokemon_id, is_active, fainted`,
    [duelId, playerId, pokemonId],
  );
  return rows[0];
}

/**
 * Persists a mid-duel switch decision (item #5): validates via the existing
 * validateSwitchDecision (ownership + not fainted + not already active), then
 * ONE transaction: deactivate the current active, activate the target bench
 * pokemon, and journal a `switch` moves row (move_index NULL,
 * target_pokemon_id = the previous active's pokemon id). When there is no
 * previous active (forced switch after a KO deactivated it), the target is
 * activated with no journal row — nothing was switched away.
 *
 * @param {number} duelId
 * @param {number} playerId
 * @param {number} pokemonId - the bench pokemon being switched in
 * @returns {Promise<object>} the activated target row
 * @throws {ValidationError} reason 'wrong_owner' | 'fainted' | 'already_active'
 */
export async function applySwitchDecision(duelId, playerId, pokemonId) {
  await validateSwitchDecision(duelId, playerId, pokemonId);

  return withTransaction(async (client) => {
    const { rows: activeRows } = await client.query(
      `SELECT pokemon_id FROM duel_pokemon_state
       WHERE duel_id = $1 AND player_id = $2 AND is_active = TRUE`,
      [duelId, playerId],
    );
    const previousActive = activeRows[0];

    const { rows: turnRows } = await client.query(
      `SELECT (1 + COUNT(*))::int AS turn FROM moves WHERE duel_id = $1`,
      [duelId],
    );
    const turnNumber = turnRows[0].turn;

    const { rows: targetRows } = await client.query(
      `UPDATE duel_pokemon_state SET is_active = TRUE
       WHERE duel_id = $1 AND player_id = $2 AND pokemon_id = $3
       RETURNING id, duel_id, player_id, pokemon_id, is_active, fainted`,
      [duelId, playerId, pokemonId],
    );

    if (previousActive) {
      await client.query(
        `UPDATE duel_pokemon_state SET is_active = FALSE
         WHERE duel_id = $1 AND player_id = $2 AND pokemon_id = $3`,
        [duelId, playerId, previousActive.pokemon_id],
      );
      await client.query(
        `INSERT INTO moves
           (duel_id, turn_number, player_id, action_type, pokemon_id, move_index, target_pokemon_id, damage_dealt, effectiveness, was_timeout)
         VALUES ($1, $2, $3, 'switch', $4, NULL, $5, NULL, NULL, FALSE)`,
        [duelId, turnNumber, playerId, pokemonId, previousActive.pokemon_id],
      );
    }

    return targetRows[0];
  });
}
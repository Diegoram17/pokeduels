/**
 * Duel repository (Phase 3). THE only module that touches Postgres for duel
 * state — the engine's public API takes IDs and fetches canonical state here
 * (ENG-04 client-state-distrust). Uses the shared `pg.Pool` from db/pool.js,
 * mirroring backend/db/* (no ORM).
 *
 * State shape (matches the pure core's contract):
 *   duel:          { id, player1_id, player2_id, status, winner_id, end_reason,
 *                    turn_number }   // turn_number COMPUTED: 1 + COUNT(moves)
 *   pokemonStates: [{ id, duel_id, player_id, pokemon_id, current_hp,
 *                     pp_move_1, pp_move_2, pp_move_3, is_active, fainted,
 *                     type }]        // type JOINed from pokemons
 *
 * `applyRoundResult` is the atomic round-commit: one transaction updating
 * duels + every duel_pokemon_state row + INSERTing every moveRow (rejected
 * actions never appear in moveRows, so they are never journaled).
 */
import { pool } from '../db/pool.js';
import { validateSwitchDecision, validateLeadSelection } from '../engine/switchValidation.js';

const POKEMON_STATE_SELECT = `
  SELECT dps.*, p.type
  FROM duel_pokemon_state dps
  JOIN pokemons p ON p.id = dps.pokemon_id
`;

const INSERT_MOVE_SQL = `
  INSERT INTO moves
    (duel_id, turn_number, player_id, action_type, pokemon_id,
     move_index, target_pokemon_id, damage_dealt, effectiveness, was_timeout)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`;

function moveParams(row) {
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
 * Fetches the canonical duel state: the duels row (plus computed turn_number)
 * and every duel_pokemon_state row for both players, each with `type` joined
 * from pokemons.
 *
 * @param {number} duelId
 * @returns {Promise<{ duel: object, pokemonStates: object[] } | null>}
 *          null when no duel exists (not-found signal — never a partial state)
 */
export async function getDuelState(duelId) {
  const { rows: duelRows } = await pool.query(
    `SELECT d.*,
            (1 + (SELECT COUNT(*) FROM moves m WHERE m.duel_id = d.id))::int AS turn_number
     FROM duels d
     WHERE d.id = $1`,
    [duelId],
  );
  const duel = duelRows[0];
  if (!duel) {
    return null;
  }

  const { rows: pokemonStates } = await pool.query(
    `${POKEMON_STATE_SELECT}
     WHERE dps.duel_id = $1
     ORDER BY dps.id`,
    [duelId],
  );

  return { duel, pokemonStates };
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
     WHERE id = $1 AND status = 'in_progress'`,
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
 * Returns the player's currently active (in_progress) duel, or null. Used by
 * the disconnect listener to decide whether a mid-duel forfeit applies (RF-6.2)
 * vs the lobby 60s reconnect grace (RF-2.7) — a DB query because there is no
 * `socket.data.duelId` field anywhere in the WS layer (only room membership).
 *
 * @param {number} playerId
 * @returns {Promise<{ id: number, player1_id: number, player2_id: number,
 *                     status: string } | null>}
 */
export async function findActiveDuelForPlayer(playerId) {
  const { rows } = await pool.query(
    `SELECT id, player1_id, player2_id, status
     FROM duels
     WHERE (player1_id = $1 OR player2_id = $1) AND status = 'in_progress'`,
    [playerId],
  );
  return rows[0] ?? null;
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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

async function insertMove(db, row) {
  await db.query(INSERT_MOVE_SQL, moveParams(row));
}

/**
 * Returns one player's roster for a duel (their duel_pokemon_state rows, with
 * `type` joined) — the input the pure switch-validation core consumes.
 *
 * @param {number} duelId
 * @param {number} playerId
 * @returns {Promise<object[]>}
 */
export async function getPlayerRoster(duelId, playerId) {
  const { rows } = await pool.query(
    `${POKEMON_STATE_SELECT}
     WHERE dps.duel_id = $1 AND dps.player_id = $2
     ORDER BY dps.id`,
    [duelId, playerId],
  );
  return rows;
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Serialize concurrent bootstraps on the room row (mirrors joinRoom's
    // FOR UPDATE pattern): the second transaction blocks here until the first
    // commits, then its existing-duel check below sees the committed row.
    await client.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);

    const { rows: existing } = await client.query(
      'SELECT id, status FROM duels WHERE room_id = $1',
      [roomId],
    );
    if (existing[0]) {
      await client.query('COMMIT');
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
       WHERE room_id = $2`,
      [duel.id, roomId],
    );

    await client.query(
      "UPDATE rooms SET status = 'in_progress' WHERE id = $1",
      [roomId],
    );

    await client.query('COMMIT');
    return duel;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    await client.query('COMMIT');
    return targetRows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Pure mapping helper (item #5): transforms the canonical snake_case
 * repository state ({ duel, pokemonStates }) into the camelCase shape the
 * frontend consumes — DuelState/DuelPokemonState per
 * frontend/src/state/schema.ts. `name`/`spriteUrl`/`backSpriteUrl` are NOT
 * part of the canonical state (they need extra pokemons joins) and are left
 * to the client wiring (#9/#10) to fill from its own catalog.
 *
 * @param {{ duel: object, pokemonStates: object[] }} duelState
 * @returns {{ duelId: number, turnNumber: number, winnerId: number|null,
 *             endReason: string|null, pokemonStates: object[] }}
 */
export function mapDuelStateToCamelCase({ duel, pokemonStates }) {
  return {
    duelId: duel.id,
    turnNumber: duel.turn_number,
    winnerId: duel.winner_id ?? null,
    endReason: duel.end_reason ?? null,
    pokemonStates: pokemonStates.map((p) => ({
      duelId: p.duel_id,
      ownerId: p.player_id,
      pokemonId: p.pokemon_id,
      type: p.type,
      currentHp: p.current_hp,
      ppMove1: p.pp_move_1,
      ppMove2: p.pp_move_2,
      ppMove3: p.pp_move_3,
      isActive: p.is_active,
      fainted: p.fainted,
    })),
  };
}
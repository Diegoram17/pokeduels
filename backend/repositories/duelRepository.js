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
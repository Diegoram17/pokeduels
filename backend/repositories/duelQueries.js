/**
 * Duel read-only queries (Phase 3, A2 split). Every SELECT that serves duel
 * state lives here — canonical state fetch, active/pending-duel lookups, and
 * one player's roster. SQL text is byte-identical to the pre-split monolithic
 * duelRepository.js.
 *
 * The barrel (../repositories/duelRepository.js) re-exports the public names;
 * `POKEMON_STATE_SELECT` is a module-level shared fragment NOT part of the
 * barrel's public API.
 */
import { pool } from '../db/pool.js';

export const POKEMON_STATE_SELECT = `
  SELECT dps.*, p.type
  FROM duel_pokemon_state dps
  JOIN pokemons p ON p.id = dps.pokemon_id
`;

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
 * Returns the player's currently active (in_progress) duel, or null. Used by
 * the disconnect listener to decide whether a mid-duel forfeit applies (RF-6.2)
 * vs the lobby 60s reconnect grace (RF-2.7) — a DB query because there is no
 * `socket.data.duelId` field anywhere in the WS layer (only room membership).
 *
 * @param {number} playerId
 * @returns {Promise<{ id: number, room_id: number, player1_id: number,
 *                     player2_id: number, status: string } | null>}
 */
export async function findActiveDuelForPlayer(playerId) {
  const { rows } = await pool.query(
    `SELECT id, room_id, player1_id, player2_id, status
     FROM duels
     WHERE (player1_id = $1 OR player2_id = $1) AND status = 'in_progress'`,
    [playerId],
  );
  return rows[0] ?? null;
}

/**
 * Finds a player's still-pending bracket duel in a room, or null (item #7,
 * walkover lookup). A between-round walkover arms a timer only when the player
 * has a 'pending' duel (created but never started) awaiting them; a duel that
 * already went 'in_progress' is a mid-duel case handled by the item-#6
 * disconnect forfeit, not a walkover. Scoped by room so a player in multiple
 * rooms never targets the wrong bracket.
 *
 * @param {number} roomId
 * @param {number} playerId
 * @returns {Promise<{ id: number, round: string, status: string,
 *                     player1_id: number, player2_id: number } | null>}
 */
export async function findPendingBracketDuelForPlayer(roomId, playerId) {
  const { rows } = await pool.query(
    `SELECT id, round, status, player1_id, player2_id
     FROM duels
     WHERE room_id = $1 AND status = 'pending'
       AND (player1_id = $2 OR player2_id = $2)
     ORDER BY id
     LIMIT 1`,
    [roomId, playerId],
  );
  return rows[0] ?? null;
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
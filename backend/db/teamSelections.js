import { pool } from './pool.js';
import { WsError } from '../lib/wsError.js';

const ROSTER_SIZE = 5;
const STARTER_SLOT = 1;
const ROSTER_SLOTS = [2, 3, 4, 5, 6];

/**
 * Inserts a starter selection for a seated player: slot 1, is_starter TRUE.
 * Starter exclusivity per room is enforced by the partial unique index
 * uq_starter_por_sala: a 23505 on it means another player already reserved
 * that pokemon → team:starter_rejected { pokemonId, reason: 'taken' }. A 23505
 * on the player's own slot/pokemon unique constraints → 'already_selected'.
 * A 23503 (unknown pokemon_id) → team:roster_rejected { reason:
 * 'not_in_catalog' } per the design's error mapping. Anything else rethrows.
 */
export async function selectStarter(roomId, playerId, pokemonId) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO team_selections (room_id, player_id, pokemon_id, is_starter, slot)
       VALUES ($1, $2, $3, TRUE, $4)
       RETURNING id, room_id, player_id, pokemon_id, is_starter, slot`,
      [roomId, playerId, pokemonId, STARTER_SLOT],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const reason = err.constraint === 'uq_starter_por_sala' ? 'taken' : 'already_selected';
      throw new WsError('team:starter_rejected', { pokemonId, reason });
    }
    if (err.code === '23503') {
      throw new WsError('team:roster_rejected', { reason: 'not_in_catalog' });
    }
    throw err;
  }
}

/**
 * Inserts a full 5-pokemon roster for a seated player at slots 2..6
 * (is_starter FALSE) in one transaction. Validation runs before any DB work:
 * payload must be exactly 5 pokemon ids with no duplicates →
 * team:roster_rejected { reason: 'invalid_count' | 'duplicate' }. DB-level
 * 23505 (slot/pokemon already taken by this player) → 'duplicate'; 23503
 * (unknown pokemon_id) → 'not_in_catalog'. Anything else rethrows.
 */
export async function selectRoster(roomId, playerId, pokemonIds) {
  if (!Array.isArray(pokemonIds) || pokemonIds.length !== ROSTER_SIZE) {
    throw new WsError('team:roster_rejected', { reason: 'invalid_count' });
  }
  if (new Set(pokemonIds).size !== ROSTER_SIZE) {
    throw new WsError('team:roster_rejected', { reason: 'duplicate' });
  }

  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    const inserted = [];
    for (let i = 0; i < ROSTER_SIZE; i += 1) {
      const { rows } = await client.query(
        `INSERT INTO team_selections (room_id, player_id, pokemon_id, is_starter, slot)
         VALUES ($1, $2, $3, FALSE, $4)
         RETURNING id, room_id, player_id, pokemon_id, is_starter, slot`,
        [roomId, playerId, pokemonIds[i], ROSTER_SLOTS[i]],
      );
      inserted.push(rows[0]);
    }

    await client.query('COMMIT');
    inTransaction = false;
    return inserted;
  } catch (err) {
    if (inTransaction) {
      await client.query('ROLLBACK').catch(() => {});
    }
    if (err.code === '23505') {
      throw new WsError('team:roster_rejected', { reason: 'duplicate' });
    }
    if (err.code === '23503') {
      throw new WsError('team:roster_rejected', { reason: 'not_in_catalog' });
    }
    throw err;
  } finally {
    client.release();
  }
}
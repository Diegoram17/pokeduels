import { pool } from './pool.js';

/**
 * Creates a player row (ephemeral identity by nickname) and returns the
 * issued session token. Nickname is not globally unique — uniqueness is
 * enforced per-room in room_players.
 */
export async function createPlayer(nickname) {
  const { rows } = await pool.query(
    `INSERT INTO players (nickname) VALUES ($1) RETURNING id, nickname, session_token`,
    [nickname],
  );
  const row = rows[0];
  return { id: row.id, nickname: row.nickname, sessionToken: row.session_token };
}

/**
 * Resolves a session token to its player while touching last_seen_at — one
 * round trip does lookup + liveness update. Returns undefined for unknown
 * tokens; a malformed (non-UUID) token raises pg 22P02, mapped to 400/401 by
 * the error middleware.
 */
export async function touchSession(token) {
  const { rows } = await pool.query(
    `UPDATE players SET last_seen_at = now() WHERE session_token = $1 RETURNING id, nickname`,
    [token],
  );
  return rows[0];
}
import { pool } from './pool.js';
import { generateRoomCode } from '../lib/roomCode.js';
import { HttpError } from '../lib/httpError.js';

const MAX_ROOM_CODE_RETRIES = 5;
const ROOM_FIELDS = 'id, code, max_players, status, created_by, created_at';

/**
 * Creates a room with a generated code and auto-joins the creator into
 * room_players, all in one transaction. On a code collision (23505 on
 * rooms_code_key) the transaction rolls back and a fresh code is tried, up to
 * MAX_ROOM_CODE_RETRIES times; any other error is rethrown. The creator's
 * nickname is read from players inside the same transaction (room_players
 * requires a non-null nickname copy).
 */
export async function createRoomWithCreator(maxPlayers, playerId) {
  const client = await pool.connect();
  try {
    for (let attempt = 0; attempt < MAX_ROOM_CODE_RETRIES; attempt += 1) {
      const code = generateRoomCode();
      try {
        await client.query('BEGIN');
        const { rows: rooms } = await client.query(
          `INSERT INTO rooms (code, max_players, created_by)
           VALUES ($1, $2, $3)
           RETURNING ${ROOM_FIELDS}`,
          [code, maxPlayers, playerId],
        );
        const room = rooms[0];
        const { rows: creators } = await client.query(
          'SELECT nickname FROM players WHERE id = $1',
          [playerId],
        );
        if (!creators[0]) {
          throw new HttpError(401, 'unknown player');
        }
        await client.query(
          `INSERT INTO room_players (room_id, player_id, nickname) VALUES ($1, $2, $3)`,
          [room.id, playerId, creators[0].nickname],
        );
        await client.query('COMMIT');
        return { ...room, player_count: 1 };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505' && err.constraint === 'rooms_code_key') {
          continue; // code collision — retry with a fresh code
        }
        throw err;
      }
    }
    throw new HttpError(500, 'could not generate a unique room code');
  } finally {
    client.release();
  }
}

/**
 * Lists rooms still waiting for players, each with its current occupancy
 * (count of room_players). Non-waiting rooms are excluded.
 */
export async function listWaitingRooms() {
  const { rows } = await pool.query(
    `SELECT r.id, r.code, r.max_players, r.status, r.created_at,
            COUNT(rp.id)::int AS player_count
     FROM rooms r
     LEFT JOIN room_players rp ON rp.room_id = r.id
     WHERE r.status = 'waiting'
     GROUP BY r.id
     ORDER BY r.created_at`,
  );
  return rows;
}

/**
 * Joins a player into a room inside one transaction that locks the room row
 * (SELECT ... FOR UPDATE) before counting room_players, so concurrent joins
 * serialize and a room can never exceed max_players. 404 for unknown codes;
 * 409 for non-waiting rooms, full rooms, and duplicate nicknames/players
 * (23505 bubbles up through the error middleware as 409).
 */
export async function joinRoom(code, playerId, nickname) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    const { rows } = await client.query(
      'SELECT id, max_players, status FROM rooms WHERE code = $1 FOR UPDATE',
      [code],
    );
    const room = rows[0];
    if (!room) {
      throw new HttpError(404, 'room not found');
    }
    if (room.status !== 'waiting') {
      throw new HttpError(409, 'room is not waiting for players');
    }

    const { rows: countRows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
      [room.id],
    );
    if (countRows[0].n >= room.max_players) {
      throw new HttpError(409, 'room is full');
    }

    await client.query(
      `INSERT INTO room_players (room_id, player_id, nickname) VALUES ($1, $2, $3)`,
      [room.id, playerId, nickname],
    );
    await client.query('COMMIT');
    inTransaction = false;

    return {
      id: room.id,
      code,
      max_players: room.max_players,
      status: room.status,
      player_count: countRows[0].n + 1,
    };
  } catch (err) {
    if (inTransaction) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
}
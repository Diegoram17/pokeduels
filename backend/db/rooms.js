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

/**
 * Returns the room_players seat row for a player in a room, or undefined when
 * the player is not seated. Used by the WS layer to distinguish a fresh join
 * from a reconnect (seat still present).
 */
export async function getRoomPlayerSeat(roomId, playerId) {
  const { rows } = await pool.query(
    `SELECT id, room_id, player_id, nickname, ready, connected
     FROM room_players
     WHERE room_id = $1 AND player_id = $2`,
    [roomId, playerId],
  );
  return rows[0];
}

/**
 * WS join entrypoint with resume semantics: if the player already has a seat
 * in the room (reconnect within the grace window), it returns the room with
 * resumed=true and inserts nothing. Otherwise it behaves like joinRoom
 * (new-seat path): 404 unknown code, 409 for non-waiting/full rooms. The room
 * row is locked FOR UPDATE so concurrent new-seat joins serialize against the
 * capacity check, mirroring joinRoom.
 */
export async function joinOrResumeRoom(code, playerId, nickname) {
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

    const { rows: seatRows } = await client.query(
      'SELECT id FROM room_players WHERE room_id = $1 AND player_id = $2',
      [room.id, playerId],
    );

    const { rows: countRows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
      [room.id],
    );

    if (seatRows[0]) {
      // Resume path: seat still exists, reconnect within grace window.
      await client.query('COMMIT');
      inTransaction = false;
      return {
        id: room.id,
        code,
        max_players: room.max_players,
        status: room.status,
        player_count: countRows[0].n,
        resumed: true,
      };
    }

    if (room.status !== 'waiting') {
      throw new HttpError(409, 'room is not waiting for players');
    }
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
      resumed: false,
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

/**
 * Persists a player's sticky ready flag. 404 when the player is not seated in
 * the room. Returns the updated seat row.
 */
export async function setPlayerReady(roomId, playerId, ready) {
  const { rows } = await pool.query(
    `UPDATE room_players SET ready = $3
     WHERE room_id = $1 AND player_id = $2
     RETURNING id, room_id, player_id, nickname, ready, connected`,
    [roomId, playerId, ready],
  );
  if (!rows[0]) {
    throw new HttpError(404, 'player is not seated in this room');
  }
  return rows[0];
}

/**
 * Removes a player's seat: deletes team_selections (releasing any starter
 * reservation) and the room_players row in one transaction. If the resulting
 * seated count is 0, the room is closed (status -> 'aborted', design decision:
 * no row delete, history preserved via cascade-safe status). No return value.
 */
export async function leaveRoom(roomId, playerId) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    await client.query(
      'DELETE FROM team_selections WHERE room_id = $1 AND player_id = $2',
      [roomId, playerId],
    );
    await client.query(
      'DELETE FROM room_players WHERE room_id = $1 AND player_id = $2',
      [roomId, playerId],
    );

    const { rows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
      [roomId],
    );
    if (rows[0].n === 0) {
      await client.query(
        "UPDATE rooms SET status = 'aborted' WHERE id = $1 AND status = 'waiting'",
        [roomId],
      );
    }

    await client.query('COMMIT');
    inTransaction = false;
  } catch (err) {
    if (inTransaction) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Pure 1v1 final-rank decision (item #7, PR 2 close-and-rank). The primary
 * rule ranks by total duel wins across the room's finished duels; the
 * most-recently-finished duel's winner breaks a tie ONLY when win counts are
 * exactly equal (never the primary rule). Exported separately so the decision
 * is unit-testable without a DB.
 *
 * @param {number} player1Id
 * @param {number} player2Id
 * @param {Record<number, number>} winsByPlayer - playerId -> win count
 * @param {number} tiebreakWinnerId - winner of the most recently finished duel
 * @returns {{ playerId: number, finalRank: number }[]} the two seats, ordered
 *          by finalRank (1 then 2)
 */
export function computeOneVOneRanks(player1Id, player2Id, winsByPlayer, tiebreakWinnerId) {
  const wins1 = winsByPlayer[player1Id] ?? 0;
  const wins2 = winsByPlayer[player2Id] ?? 0;

  let first;
  if (wins1 > wins2) first = player1Id;
  else if (wins2 > wins1) first = player2Id;
  else first = tiebreakWinnerId; // equal wins -> most-recent-duel winner (tiebreak only)
  const second = first === player1Id ? player2Id : player1Id;

  return [
    { playerId: first, finalRank: 1 },
    { playerId: second, finalRank: 2 },
  ];
}

/**
 * Unified room-close entrypoint (item #7, PR 2 1v1 close-and-rank). Called
 * from room:leave and the lobby-grace disconnect callback in place of the raw
 * leaveRoom. Branches on rooms.status under a FOR UPDATE room-row lock:
 *
 *   - 'waiting' (no duel ever played): delegates to the existing leaveRoom —
 *     removes the seat, aborts the room when empty. No rank/close/event
 *     (Out-of-Scope boundary, leaveRoom itself untouched).
 *   - 'finished'/'aborted' (already closed): idempotent no-op — a second leave
 *     never re-ranks or re-closes (near-simultaneous double-leave safety).
 *   - 'in_progress' + max_players === 2: 1v1 close-and-rank — assigns
 *     room_players.final_rank 1/2 by total win count (most-recent-duel
 *     tiebreak), sets rooms.status='finished', and returns the ranking so the
 *     caller can emit room:final_ranking. Seats are NOT deleted (the schema
 *     comment on final_rank requires the row to survive).
 *   - 'in_progress' + max_players === 4: delegates to leaveRoom for now — the
 *     bracket/walkover leave path is PR 3.
 *
 * @param {number} roomId
 * @param {number} playerId
 * @returns {Promise<{ closed: boolean, roomId?: number,
 *                     ranking?: { playerId:number, nickname:string, finalRank:number }[] }>}
 *          closed=true only when the room was closed-and-ranked this call.
 */
export async function leaveOrCloseRoom(roomId, playerId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT id, max_players, status FROM rooms WHERE id = $1 FOR UPDATE',
      [roomId],
    );
    const room = rows[0];
    if (!room) {
      await client.query('COMMIT');
      return { closed: false };
    }

    if (room.status === 'waiting') {
      // Pre-tournament leave: no duel ever played. Release the lock first
      // (leaveRoom opens its own transaction) and reuse the existing behavior.
      await client.query('COMMIT');
      await leaveRoom(roomId, playerId);
      return { closed: false };
    }

    if (room.status !== 'in_progress') {
      // Already finished/aborted: idempotent no-op (double-leave/double-disconnect).
      await client.query('COMMIT');
      return { closed: false };
    }

    // Only 1v1 close-and-rank is PR 2 scope; a 4-player in_progress room leaves
    // through the bracket/walkover path (PR 3). Delegate so nothing regresses.
    if (room.max_players !== 2) {
      await client.query('COMMIT');
      await leaveRoom(roomId, playerId);
      return { closed: false };
    }

    const { rows: seatRows } = await client.query(
      'SELECT player_id, nickname FROM room_players WHERE room_id = $1',
      [roomId],
    );
    // A 1v1 close ranks BOTH seats; if the room somehow lacks exactly two, fall
    // back to plain leaveRoom rather than emitting a malformed ranking.
    if (seatRows.length !== 2) {
      await client.query('COMMIT');
      await leaveRoom(roomId, playerId);
      return { closed: false };
    }

    const { rows: winRows } = await client.query(
      `SELECT winner_id, COUNT(*)::int AS wins
       FROM duels
       WHERE room_id = $1 AND status = 'finished' AND winner_id IS NOT NULL
       GROUP BY winner_id`,
      [roomId],
    );
    const winsByPlayer = Object.fromEntries(winRows.map((r) => [r.winner_id, r.wins]));

    const { rows: tieRows } = await client.query(
      `SELECT winner_id FROM duels
       WHERE room_id = $1 AND status = 'finished' AND winner_id IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [roomId],
    );
    const tiebreakWinnerId = tieRows[0]?.winner_id ?? seatRows[0].player_id;

    const [seat1, seat2] = seatRows;
    const ranks = computeOneVOneRanks(
      seat1.player_id,
      seat2.player_id,
      winsByPlayer,
      tiebreakWinnerId,
    );

    for (const { playerId, finalRank } of ranks) {
      await client.query(
        'UPDATE room_players SET final_rank = $1 WHERE room_id = $2 AND player_id = $3',
        [finalRank, roomId, playerId],
      );
    }
    await client.query("UPDATE rooms SET status = 'finished' WHERE id = $1", [roomId]);

    const ranking = ranks.map(({ playerId, finalRank }) => {
      const seat = seatRows.find((s) => s.player_id === playerId);
      return { playerId, nickname: seat.nickname, finalRank };
    });

    await client.query('COMMIT');
    return { closed: true, roomId, ranking };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Marks a seated player connected (reconnect path). No error for unknown
 * seats — the caller controls seat existence.
 */
export async function markPlayerConnected(roomId, playerId) {
  await pool.query(
    'UPDATE room_players SET connected = TRUE WHERE room_id = $1 AND player_id = $2',
    [roomId, playerId],
  );
}

/**
 * Marks a seated player disconnected (native socket disconnect path). No error
 * for unknown seats.
 */
export async function markPlayerDisconnected(roomId, playerId) {
  await pool.query(
    'UPDATE room_players SET connected = FALSE WHERE room_id = $1 AND player_id = $2',
    [roomId, playerId],
  );
}

/**
 * Fetches the full lobby state of a room for the room:state broadcast:
 * room metadata (camelCase keys), seated players with ready/connected flags,
 * and the list of starter pokemon ids already reserved. Returns undefined for
 * an unknown roomId (callers broadcast only for rooms they just touched).
 */
export async function getRoomState(roomId) {
  const { rows: roomRows } = await pool.query(
    'SELECT id, code, status, max_players FROM rooms WHERE id = $1',
    [roomId],
  );
  const room = roomRows[0];
  if (!room) return undefined;

  const { rows: players } = await pool.query(
    `SELECT player_id, nickname, ready, connected
     FROM room_players
     WHERE room_id = $1
     ORDER BY joined_at`,
    [roomId],
  );
  const { rows: starters } = await pool.query(
    'SELECT pokemon_id FROM team_selections WHERE room_id = $1 AND is_starter = TRUE',
    [roomId],
  );

  return {
    roomId: room.id,
    code: room.code,
    status: room.status,
    maxPlayers: room.max_players,
    players: players.map((p) => ({
      playerId: p.player_id,
      nickname: p.nickname,
      ready: p.ready,
      connected: p.connected,
    })),
    startersTaken: starters.map((s) => s.pokemon_id),
  };
}
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { createRoomWithCreator, listWaitingRooms, joinRoom } from '../db/rooms.js';
import {
  getRoomPlayerSeat,
  joinOrResumeRoom,
  setPlayerReady,
  leaveRoom,
  leaveOrCloseRoom,
  markPlayerConnected,
  markPlayerDisconnected,
  getRoomState,
} from '../db/rooms.js';
import { generateRoomCode } from '../lib/roomCode.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';

// Wraps the real generator as the default implementation so every existing
// call-through keeps producing real random codes; only the two collision
// tests below queue `mockReturnValueOnce` overrides on top of it, and the
// queue drains back to the real implementation automatically once exhausted.
vi.mock('../lib/roomCode.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, generateRoomCode: vi.fn(actual.generateRoomCode) };
});

// Exact 32-char room-code charset from lib/roomCode.js (excludes 0/O/1/I/L):
// ABCDEFGHJKMNPQRSTUVWXYZ23456789 → [A-HJKMNP-Z2-9]
const CODE_RE = /^[A-HJKMNP-Z2-9]{6}$/;

describe.skipIf(!hasDatabase)('rooms API (requires DATABASE_URL)', () => {
  // Track room ids created by collision tests so afterAll can clean them up.
  // Without this, hard-coded collision codes ('ABCJKM', 'DEFGHJ') persist
  // across CI runs and cause "duplicate key" failures on the next run.
  const collisionRoomIds = [];

  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
  }, SEED_TIMEOUT);

  afterAll(async () => {
    // Clean up rooms created by collision tests (hard-coded codes).
    if (collisionRoomIds.length) {
      await pool.query('DELETE FROM rooms WHERE id = ANY($1::int[])', [collisionRoomIds]);
    }
    await pool.end();
  });

  describe('db layer: createRoomWithCreator / listWaitingRooms / joinRoom', () => {
    it('createRoomWithCreator inserts a room and auto-joins the creator', async () => {
      const player = await createPlayer('CreatorDb1');
      const room = await createRoomWithCreator(4, player.id);

      expect(room.code).toMatch(CODE_RE);
      expect(room.max_players).toBe(4);
      expect(room.status).toBe('waiting');
      expect(room.player_count).toBe(1);

      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1 AND player_id = $2',
        [room.id, player.id],
      );
      expect(rows[0].n).toBe(1);
    });

    it('retries transparently on a single code collision and succeeds with a distinct code', async () => {
      generateRoomCode.mockClear();
      const collidingCode = 'ABCJKM';
      const seedPlayer = await createPlayer('CollideOnceSeedDb');
      const { rows: insertedRows } = await pool.query(
        'INSERT INTO rooms (code, max_players, created_by) VALUES ($1, $2, $3) RETURNING id',
        [collidingCode, 2, seedPlayer.id],
      );
      collisionRoomIds.push(insertedRows[0].id);

      // First call returns the already-taken code (forces a 23505 on
      // rooms_code_key); the queue then drains and the next call falls back
      // to the real generator, producing a fresh, non-colliding code.
      generateRoomCode.mockReturnValueOnce(collidingCode);

      const player = await createPlayer('CollideOnceDb');
      const room = await createRoomWithCreator(4, player.id);

      expect(room.code).toMatch(CODE_RE);
      expect(room.code).not.toBe(collidingCode);
      expect(generateRoomCode).toHaveBeenCalledTimes(2);

      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM rooms WHERE code = $1', [
        collidingCode,
      ]);
      expect(rows[0].n).toBe(1); // still only the pre-seeded row, not duplicated
    });

    it('throws after 5 consecutive code collisions and creates no room', async () => {
      generateRoomCode.mockClear();
      const collidingCode = 'DEFGHJ';
      const seedPlayer = await createPlayer('CollideExhaustedSeedDb');
      const { rows: insertedRows } = await pool.query(
        'INSERT INTO rooms (code, max_players, created_by) VALUES ($1, $2, $3) RETURNING id',
        [collidingCode, 2, seedPlayer.id],
      );
      collisionRoomIds.push(insertedRows[0].id);

      // All 5 retry attempts (MAX_ROOM_CODE_RETRIES) collide with the same
      // pre-seeded code, so the loop must exhaust and reject.
      generateRoomCode
        .mockReturnValueOnce(collidingCode)
        .mockReturnValueOnce(collidingCode)
        .mockReturnValueOnce(collidingCode)
        .mockReturnValueOnce(collidingCode)
        .mockReturnValueOnce(collidingCode);

      const player = await createPlayer('CollideExhaustedDb');
      const before = await pool.query('SELECT COUNT(*)::int AS n FROM rooms');

      await expect(createRoomWithCreator(4, player.id)).rejects.toMatchObject({
        statusCode: 500,
      });

      expect(generateRoomCode).toHaveBeenCalledTimes(5);
      const after = await pool.query('SELECT COUNT(*)::int AS n FROM rooms');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('listWaitingRooms excludes in_progress and finished rooms', async () => {
      const p1 = await createPlayer('ListDb1');
      const p2 = await createPlayer('ListDb2');
      const p3 = await createPlayer('ListDb3');
      const waiting = await createRoomWithCreator(2, p1.id);
      const inProgress = await createRoomWithCreator(2, p2.id);
      const finished = await createRoomWithCreator(2, p3.id);
      await pool.query("UPDATE rooms SET status = 'in_progress' WHERE id = $1", [inProgress.id]);
      await pool.query("UPDATE rooms SET status = 'finished' WHERE id = $1", [finished.id]);

      const rooms = await listWaitingRooms();
      const codes = rooms.map((r) => r.code);
      expect(codes).toContain(waiting.code);
      expect(codes).not.toContain(inProgress.code);
      expect(codes).not.toContain(finished.code);
      const waitingRow = rooms.find((r) => r.code === waiting.code);
      expect(waitingRow.max_players).toBe(2);
      expect(waitingRow.player_count).toBe(1);
    });

    it('joinRoom adds a player within capacity and bumps the count', async () => {
      const creator = await createPlayer('JoinDbCreator');
      const joiner = await createPlayer('JoinDbJoiner');
      const room = await createRoomWithCreator(2, creator.id);

      const joined = await joinRoom(room.code, joiner.id, 'JoinDbJoiner');
      expect(joined.player_count).toBe(2);

      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
        [room.id],
      );
      expect(rows[0].n).toBe(2);
    });

    it('joinRoom rejects a full room with 409', async () => {
      const creator = await createPlayer('FullDbCreator');
      const joiner2 = await createPlayer('FullDbJoiner2');
      const joiner3 = await createPlayer('FullDbJoiner3');
      const room = await createRoomWithCreator(2, creator.id);
      await joinRoom(room.code, joiner2.id, 'FullDbJoiner2');

      await expect(joinRoom(room.code, joiner3.id, 'FullDbJoiner3')).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('joinRoom rejects an unknown code with 404', async () => {
      const player = await createPlayer('NotFoundDb');
      await expect(joinRoom('ZZZZZZ', player.id, 'NotFoundDb')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('db layer: WS-facing room functions (PR 1)', () => {
    it('getRoomPlayerSeat returns the seat row for a seated player and undefined otherwise', async () => {
      const creator = await createPlayer('WsSeatCreator');
      const stranger = await createPlayer('WsSeatStranger');
      const room = await createRoomWithCreator(4, creator.id);

      const seat = await getRoomPlayerSeat(room.id, creator.id);
      expect(seat.player_id).toBe(creator.id);
      expect(seat.room_id).toBe(room.id);
      expect(seat.ready).toBe(false);
      expect(seat.connected).toBe(true);

      const missing = await getRoomPlayerSeat(room.id, stranger.id);
      expect(missing).toBeUndefined();
    });

    it('joinOrResumeRoom inserts a new seat with resumed=false and returns the room', async () => {
      const creator = await createPlayer('WsJoinCreator');
      const joiner = await createPlayer('WsJoinJoiner');
      const room = await createRoomWithCreator(2, creator.id);

      const joined = await joinOrResumeRoom(room.code, joiner.id, 'WsJoinJoiner');
      expect(joined.resumed).toBe(false);
      expect(joined.id).toBe(room.id);
      expect(joined.code).toBe(room.code);
      expect(joined.max_players).toBe(2);
      expect(joined.status).toBe('waiting');
      expect(joined.player_count).toBe(2);
    });

    it('joinOrResumeRoom resumes an existing seat with resumed=true without duplicating it', async () => {
      const creator = await createPlayer('WsResumeCreator');
      const room = await createRoomWithCreator(4, creator.id);

      const resumed = await joinOrResumeRoom(room.code, creator.id, 'WsResumeCreator');
      expect(resumed.resumed).toBe(true);
      expect(resumed.player_count).toBe(1);

      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1 AND player_id = $2',
        [room.id, creator.id],
      );
      expect(rows[0].n).toBe(1);
    });

    it('joinOrResumeRoom rejects an unknown code with 404', async () => {
      const player = await createPlayer('WsJoin404');
      await expect(joinOrResumeRoom('ZZZZZZ', player.id, 'WsJoin404')).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('joinOrResumeRoom rejects a non-waiting room with 409 on the new-seat path', async () => {
      const creator = await createPlayer('WsNotWait');
      const joiner = await createPlayer('WsNotWaitJ');
      const room = await createRoomWithCreator(4, creator.id);
      await pool.query("UPDATE rooms SET status = 'in_progress' WHERE id = $1", [room.id]);

      await expect(joinOrResumeRoom(room.code, joiner.id, 'WsNotWaitJ')).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('joinOrResumeRoom rejects a full room with 409 on the new-seat path', async () => {
      const creator = await createPlayer('WsFullCreator');
      const j2 = await createPlayer('WsFullJ2');
      const j3 = await createPlayer('WsFullJ3');
      const room = await createRoomWithCreator(2, creator.id);
      await joinRoom(room.code, j2.id, 'WsFullJ2');

      await expect(joinOrResumeRoom(room.code, j3.id, 'WsFullJ3')).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('setPlayerReady persists the ready flag and returns the updated row', async () => {
      const creator = await createPlayer('WsReadyCreator');
      const room = await createRoomWithCreator(4, creator.id);

      const updated = await setPlayerReady(room.id, creator.id, true);
      expect(updated.ready).toBe(true);

      const again = await setPlayerReady(room.id, creator.id, false);
      expect(again.ready).toBe(false);
    });

    it('setPlayerReady throws 404 when the player is not seated', async () => {
      const owner = await createPlayer('WsReadyOwner');
      const stranger = await createPlayer('WsReadyStranger');
      const room = await createRoomWithCreator(4, owner.id);

      await expect(setPlayerReady(room.id, stranger.id, true)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('leaveRoom removes the seat and starter selection but keeps the room waiting with others seated', async () => {
      const creator = await createPlayer('WsLeaveCreator');
      const j2 = await createPlayer('WsLeaveJ2');
      const room = await createRoomWithCreator(4, creator.id);
      await joinRoom(room.code, j2.id, 'WsLeaveJ2');
      const { rows: pokemons } = await pool.query('SELECT id FROM pokemons LIMIT 1');
      await pool.query(
        'INSERT INTO team_selections (room_id, player_id, pokemon_id, is_starter, slot) VALUES ($1, $2, $3, TRUE, 1)',
        [room.id, j2.id, pokemons[0].id],
      );

      await leaveRoom(room.id, j2.id);

      const { rows: seats } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
        [room.id],
      );
      expect(seats[0].n).toBe(1);
      const { rows: selections } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM team_selections WHERE room_id = $1 AND player_id = $2',
        [room.id, j2.id],
      );
      expect(selections[0].n).toBe(0);
      const { rows: roomRows } = await pool.query('SELECT status FROM rooms WHERE id = $1', [room.id]);
      expect(roomRows[0].status).toBe('waiting');
    });

    it('leaveRoom deletes the room when the last seated player leaves a waiting room', async () => {
      const creator = await createPlayer('WsCloseCreator');
      const room = await createRoomWithCreator(2, creator.id);

      await leaveRoom(room.id, creator.id);

      const { rows: seats } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
        [room.id],
      );
      expect(seats[0].n).toBe(0);
      const { rows: roomRows } = await pool.query('SELECT id FROM rooms WHERE id = $1', [room.id]);
      expect(roomRows.length).toBe(0);
    });

    it('markPlayerConnected / markPlayerDisconnected flip the connected flag', async () => {
      const creator = await createPlayer('WsConnCreator');
      const room = await createRoomWithCreator(4, creator.id);

      await markPlayerDisconnected(room.id, creator.id);
      expect((await getRoomPlayerSeat(room.id, creator.id)).connected).toBe(false);

      await markPlayerConnected(room.id, creator.id);
      expect((await getRoomPlayerSeat(room.id, creator.id)).connected).toBe(true);
    });

    it('getRoomState returns players, ready flags and startersTaken', async () => {
      const creator = await createPlayer('WsStateCreator');
      const j2 = await createPlayer('WsStateJ2');
      const room = await createRoomWithCreator(4, creator.id);
      await joinRoom(room.code, j2.id, 'WsStateJ2');
      await setPlayerReady(room.id, creator.id, true);
      const { rows: pokemons } = await pool.query('SELECT id FROM pokemons LIMIT 1');
      await pool.query(
        'INSERT INTO team_selections (room_id, player_id, pokemon_id, is_starter, slot) VALUES ($1, $2, $3, TRUE, 1)',
        [room.id, creator.id, pokemons[0].id],
      );

      const state = await getRoomState(room.id);
      expect(state.roomId).toBe(room.id);
      expect(state.code).toBe(room.code);
      expect(state.status).toBe('waiting');
      expect(state.maxPlayers).toBe(4);
      expect(state.players).toHaveLength(2);
      const creatorState = state.players.find((p) => p.playerId === creator.id);
      expect(creatorState.nickname).toBe('WsStateCreator');
      expect(creatorState.ready).toBe(true);
      expect(creatorState.connected).toBe(true);
      expect(state.startersTaken).toEqual([pokemons[0].id]);
    });
  });

  describe('db layer: leaveOrCloseRoom (item #7, PR 2 close-and-rank)', () => {
    /**
     * Creates a 1v1 room with two seated players and marks the room
     * in_progress (as createDuelFromRoom does). Returns the room and players.
     */
    async function createPlayedRoom(prefix) {
      const p1 = await createPlayer(`${prefix}1`);
      const p2 = await createPlayer(`${prefix}2`);
      const room = await createRoomWithCreator(2, p1.id);
      await joinRoom(room.code, p2.id, `${prefix}2`);
      await pool.query("UPDATE rooms SET status = 'in_progress' WHERE id = $1", [room.id]);
      return { room, p1, p2 };
    }

    /**
     * Inserts a finished duel into a room crediting `winnerId`. The second
     * param lets a test force a specific finish order (older first) for the
     * tiebreak scenario.
     */
    async function insertFinishedDuel(roomId, player1Id, player2Id, winnerId, opts = {}) {
      await pool.query(
        `INSERT INTO duels (room_id, player1_id, player2_id, round, status, winner_id, end_reason, created_at)
         VALUES ($1, $2, $3, 'unica', 'finished', $4, 'ko', $5)`,
        [
          roomId,
          player1Id,
          player2Id,
          winnerId,
          opts.createdAt ?? '2024-01-01T00:00:00Z',
        ],
      );
    }

    it('closes an in_progress 1v1 room and ranks by win count (2-1 series)', async () => {
      const { room, p1, p2 } = await createPlayedRoom('Rank2v1');
      // 2 wins for p1, 1 for p2 -> p1 rank 1, p2 rank 2.
      await insertFinishedDuel(room.id, p1.id, p2.id, p1.id);
      await insertFinishedDuel(room.id, p1.id, p2.id, p1.id, { createdAt: '2024-01-02T00:00:00Z' });
      await insertFinishedDuel(room.id, p1.id, p2.id, p2.id, { createdAt: '2024-01-03T00:00:00Z' });

      const result = await leaveOrCloseRoom(room.id, p1.id);

      expect(result.closed).toBe(true);
      expect(result.roomId).toBe(room.id);
      const rank = (id) => result.ranking.find((r) => r.playerId === id);
      expect(rank(p1.id)).toMatchObject({ playerId: p1.id, finalRank: 1 });
      expect(rank(p2.id)).toMatchObject({ playerId: p2.id, finalRank: 2 });

      const { rows } = await pool.query('SELECT status FROM rooms WHERE id = $1', [room.id]);
      expect(rows[0].status).toBe('finished');
      const { rows: seats } = await pool.query(
        'SELECT player_id, final_rank FROM room_players WHERE room_id = $1 ORDER BY player_id',
        [room.id],
      );
      const byId = Object.fromEntries(seats.map((s) => [s.player_id, s.final_rank]));
      expect(byId[p1.id]).toBe(1);
      expect(byId[p2.id]).toBe(2);
    });

    it('breaks a 1-1 tie by the most recently finished duel winner', async () => {
      const { room, p1, p2 } = await createPlayedRoom('RankTie');
      await insertFinishedDuel(room.id, p1.id, p2.id, p1.id, { createdAt: '2024-01-01T00:00:00Z' });
      // Most recent finished duel's winner is p2 -> p2 must rank 1st (tiebreak).
      await insertFinishedDuel(room.id, p1.id, p2.id, p2.id, { createdAt: '2024-01-02T00:00:00Z' });

      const result = await leaveOrCloseRoom(room.id, p2.id);

      expect(result.closed).toBe(true);
      const rank = (id) => result.ranking.find((r) => r.playerId === id);
      expect(rank(p2.id).finalRank).toBe(1);
      expect(rank(p1.id).finalRank).toBe(2);
    });

    it('is idempotent: a second leave on an already-finished room is a no-op', async () => {
      const { room, p1, p2 } = await createPlayedRoom('RankIdem');
      await insertFinishedDuel(room.id, p1.id, p2.id, p1.id);

      const first = await leaveOrCloseRoom(room.id, p1.id);
      expect(first.closed).toBe(true);

      // A second leave must not re-close, re-rank, or return closed again.
      const second = await leaveOrCloseRoom(room.id, p2.id);
      expect(second.closed).toBe(false);

      const { rows } = await pool.query(
        'SELECT final_rank FROM room_players WHERE room_id = $1 AND player_id = $2',
        [room.id, p1.id],
      );
      expect(rows[0].final_rank).toBe(1);
    });

    it('delegates to leaveRoom for a waiting room (no duel ever played)', async () => {
      const { room, p1, p2 } = await createPlayedRoom('RankWait');
      // Reset the room back to waiting (no duel was actually created).
      await pool.query("UPDATE rooms SET status = 'waiting' WHERE id = $1", [room.id]);

      const result = await leaveOrCloseRoom(room.id, p2.id);

      // Pre-tournament leave keeps the existing leaveRoom behavior: no close,
      // no rank/event, and the seat is removed.
      expect(result.closed).toBe(false);
      expect(await getRoomPlayerSeat(room.id, p2.id)).toBeUndefined();
      const { rows } = await pool.query('SELECT status FROM rooms WHERE id = $1', [room.id]);
      expect(rows[0].status).toBe('waiting');
    });

    it('keeps the winning seat ranked 1 even in a 1-0 series', async () => {
      const { room, p1, p2 } = await createPlayedRoom('Rank1v0');
      await insertFinishedDuel(room.id, p1.id, p2.id, p2.id);

      const result = await leaveOrCloseRoom(room.id, p1.id);

      expect(result.closed).toBe(true);
      const rank = (id) => result.ranking.find((r) => r.playerId === id);
      expect(rank(p2.id).finalRank).toBe(1);
      expect(rank(p1.id).finalRank).toBe(2);
    });
  });

  describe('POST /api/rooms', () => {
    it('returns 401 without an Authorization header and creates no room', async () => {
      const app = createApp();
      const before = await pool.query('SELECT COUNT(*)::int AS n FROM rooms');

      const res = await request(app).post('/api/rooms').send({ max_players: 2 });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeTruthy();
      const after = await pool.query('SELECT COUNT(*)::int AS n FROM rooms');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('returns 401 for an unknown session token', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', 'Bearer 00000000-0000-4000-8000-000000000000')
        .send({ max_players: 2 });
      expect(res.status).toBe(401);
    });

    it('returns 401 for a malformed (non-UUID) token', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', 'Bearer not-a-uuid')
        .send({ max_players: 2 });
      expect(res.status).toBe(401);
    });

    it('returns 400 for an invalid max_players and creates no room', async () => {
      const player = await createPlayer('BadMaxPlayers');
      const app = createApp();
      const before = await pool.query('SELECT COUNT(*)::int AS n FROM rooms');

      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${player.sessionToken}`)
        .send({ max_players: 3 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
      const after = await pool.query('SELECT COUNT(*)::int AS n FROM rooms');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('returns 201 with a 6-char code and auto-joins the creator', async () => {
      const player = await createPlayer('CreateOk');
      const app = createApp();
      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${player.sessionToken}`)
        .send({ max_players: 4 });

      expect(res.status).toBe(201);
      expect(res.body.code).toMatch(CODE_RE);
      expect(res.body.max_players).toBe(4);
      expect(res.body.status).toBe('waiting');
      expect(res.body.player_count).toBe(1);

      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1 AND player_id = $2',
        [res.body.id, player.id],
      );
      expect(rows[0].n).toBe(1);
    });

    it('returns 429 on the 6th create within the minute', async () => {
      const player = await createPlayer('RoomRateProbe');
      const app = createApp();
      const auth = { Authorization: `Bearer ${player.sessionToken}` };

      for (let i = 0; i < 5; i += 1) {
        const res = await request(app).post('/api/rooms').set(auth).send({ max_players: 2 });
        expect(res.status).toBe(201);
      }

      const sixth = await request(app).post('/api/rooms').set(auth).send({ max_players: 2 });
      expect(sixth.status).toBe(429);
    });
  });

  describe('GET /api/rooms', () => {
    it('returns only waiting rooms with code, max_players and player_count', async () => {
      const p1 = await createPlayer('GetWait1');
      const p2 = await createPlayer('GetWait2');
      const p3 = await createPlayer('GetWait3');
      const app = createApp();
      const auth = (p) => ({ Authorization: `Bearer ${p.sessionToken}` });

      const waiting = await request(app)
        .post('/api/rooms')
        .set(auth(p1))
        .send({ max_players: 2 });
      const inProgress = await request(app)
        .post('/api/rooms')
        .set(auth(p2))
        .send({ max_players: 2 });
      const finished = await request(app)
        .post('/api/rooms')
        .set(auth(p3))
        .send({ max_players: 2 });
      expect(waiting.status).toBe(201);
      expect(inProgress.status).toBe(201);
      expect(finished.status).toBe(201);

      await pool.query("UPDATE rooms SET status = 'in_progress' WHERE id = $1", [
        inProgress.body.id,
      ]);
      await pool.query("UPDATE rooms SET status = 'finished' WHERE id = $1", [finished.body.id]);

      const res = await request(app).get('/api/rooms');
      expect(res.status).toBe(200);

      const codes = res.body.map((r) => r.code);
      expect(codes).toContain(waiting.body.code);
      expect(codes).not.toContain(inProgress.body.code);
      expect(codes).not.toContain(finished.body.code);
      const row = res.body.find((r) => r.code === waiting.body.code);
      expect(row.max_players).toBe(2);
      expect(row.player_count).toBe(1);
    });
  });

  describe('POST /api/rooms/:code/join', () => {
    it('returns 201 for a valid join within capacity', async () => {
      const creator = await createPlayer('JoinCreator');
      const joiner = await createPlayer('JoinJoiner');
      const app = createApp();
      const created = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${creator.sessionToken}`)
        .send({ max_players: 2 });
      expect(created.status).toBe(201);

      const res = await request(app)
        .post(`/api/rooms/${created.body.code}/join`)
        .set('Authorization', `Bearer ${joiner.sessionToken}`)
        .send({ nickname: 'JoinJoiner' });

      expect(res.status).toBe(201);
      expect(res.body.player_count).toBe(2);

      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
        [created.body.id],
      );
      expect(rows[0].n).toBe(2);
    });

    it('returns 409 when the room is full and inserts nothing', async () => {
      const creator = await createPlayer('FullCreator');
      const j2 = await createPlayer('FullJ2');
      const j3 = await createPlayer('FullJ3');
      const app = createApp();
      const created = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${creator.sessionToken}`)
        .send({ max_players: 2 });
      expect(created.status).toBe(201);

      const join2 = await request(app)
        .post(`/api/rooms/${created.body.code}/join`)
        .set('Authorization', `Bearer ${j2.sessionToken}`)
        .send({ nickname: 'FullJ2' });
      expect(join2.status).toBe(201);

      const before = await pool.query(
        'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
        [created.body.id],
      );
      const join3 = await request(app)
        .post(`/api/rooms/${created.body.code}/join`)
        .set('Authorization', `Bearer ${j3.sessionToken}`)
        .send({ nickname: 'FullJ3' });
      expect(join3.status).toBe(409);

      const after = await pool.query(
        'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
        [created.body.id],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('returns 409 for a duplicate nickname already in the room', async () => {
      const creator = await createPlayer('Ash');
      const other = await createPlayer('Other');
      const app = createApp();
      const created = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${creator.sessionToken}`)
        .send({ max_players: 4 });
      expect(created.status).toBe(201);

      // The creator auto-joined as 'Ash'; another player claiming 'Ash' must 409.
      const res = await request(app)
        .post(`/api/rooms/${created.body.code}/join`)
        .set('Authorization', `Bearer ${other.sessionToken}`)
        .send({ nickname: 'Ash' });
      expect(res.status).toBe(409);
    });

    it('returns 404 for an unknown room code', async () => {
      const player = await createPlayer('NoRoom');
      const app = createApp();
      const res = await request(app)
        .post('/api/rooms/ZZZZZZ/join')
        .set('Authorization', `Bearer ${player.sessionToken}`)
        .send({ nickname: 'NoRoom' });
      expect(res.status).toBe(404);
    });

    it('concurrency: 3 parallel joins on a 2-slot room → exactly one 201, two 409', async () => {
      const creator = await createPlayer('ConcCreator');
      const a = await createPlayer('ConcA');
      const b = await createPlayer('ConcB');
      const c = await createPlayer('ConcC');
      const app = createApp();
      const created = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${creator.sessionToken}`)
        .send({ max_players: 2 });
      expect(created.status).toBe(201);

      const joins = await Promise.all(
        [a, b, c].map((p) =>
          request(app)
            .post(`/api/rooms/${created.body.code}/join`)
            .set('Authorization', `Bearer ${p.sessionToken}`)
            .send({ nickname: p.nickname }),
        ),
      );

      const statuses = joins.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409]);

      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
        [created.body.id],
      );
      expect(rows[0].n).toBe(2);
    });
  });
});
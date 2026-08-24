import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { createRoomWithCreator, getRoomPlayerSeat } from '../db/rooms.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';
import { startWsHarness, waitForEvent, joinRoomViaWs } from './wsHelpers.js';

/**
 * End-to-end lobby flow over a real Socket.IO connection (spec: Join Room,
 * Ready State Toggle, Leave Room, Room Lifecycle at Low Player Count).
 * Each test runs against a fresh ephemeral WS harness (Express app + Socket.IO
 * on an OS-assigned port) and a fresh room in the shared Neon database.
 *
 * Broadcasts go to the `room:{roomId}` channel; a leaving socket stays in the
 * channel (PR 2 decision: room:leave does not socket.leave), so the leaver
 * still receives the post-leave room:state — asserted where relevant.
 */
describe.skipIf(!hasDatabase)('room lobby over WS (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
    await pool.query('SELECT 1'); // warm the Neon cold start
  }, SEED_TIMEOUT);

  const roomIds = [];
  const harnesses = [];

  async function startHarness() {
    const harness = await startWsHarness();
    harnesses.push(harness);
    return harness;
  }

  afterEach(async () => {
    while (harnesses.length) await harnesses.pop().teardown();
  });

  afterAll(async () => {
    if (roomIds.length) {
      await pool.query('DELETE FROM rooms WHERE id = ANY($1::int[])', [roomIds]);
    }
    await pool.end();
  });

  /** Fresh room with the creator pre-seated; the joiner joins over WS later. */
  async function createSeatedRoom() {
    const creator = await createPlayer('WsRoomCreator');
    const joiner = await createPlayer('WsRoomJoiner');
    const room = await createRoomWithCreator(4, creator.id);
    roomIds.push(room.id);
    return { creator, joiner, room };
  }

  /**
   * Seats both players over WS. The joiner's join broadcast reaches BOTH
   * sockets, so the creator's copy is consumed here — otherwise a later
   * waitForEvent(creatorClient, 'room:state') could catch this stale event
   * while a subsequent handler is still committing (slow Neon latency).
   */
  async function seatBoth(harness, creator, joiner, room) {
    const { client: creatorClient } = await joinRoomViaWs(harness, creator, room.code);
    const staleP = waitForEvent(creatorClient, 'room:state');
    const { client: joinerClient } = await joinRoomViaWs(harness, joiner, room.code);
    await staleP;
    return { creatorClient, joinerClient };
  }

  it('broadcasts room:state when a player joins an open room', async () => {
    const harness = await startHarness();
    const { creator, joiner, room } = await createSeatedRoom();

    // Creator resumes their existing seat so their socket joins the channel.
    await joinRoomViaWs(harness, creator, room.code);

    const joinerClient = await harness.connect(joiner.sessionToken);
    const stateP = waitForEvent(joinerClient, 'room:state');
    joinerClient.emit('room:join', { code: room.code, nickname: joiner.nickname });
    const state = await stateP;

    expect(state.roomId).toBe(room.id);
    expect(state.status).toBe('waiting');
    expect(state.players).toHaveLength(2);
    const joinerState = state.players.find((p) => p.playerId === joiner.id);
    expect(joinerState.nickname).toBe(joiner.nickname);
    expect(joinerState.ready).toBe(false);
    expect(joinerState.connected).toBe(true);

    // DB proof: the seat row was inserted.
    const seat = await getRoomPlayerSeat(room.id, joiner.id);
    expect(seat).toBeDefined();
    expect(seat.ready).toBe(false);
  });

  it('persists the ready flag and broadcasts room:state on toggle', async () => {
    const harness = await startHarness();
    const { creator, joiner, room } = await createSeatedRoom();
    const { creatorClient, joinerClient } = await seatBoth(harness, creator, joiner, room);

    const onP = waitForEvent(joinerClient, 'room:state');
    joinerClient.emit('room:ready', { ready: true });
    const on = await onP;
    expect(on.players.find((p) => p.playerId === joiner.id).ready).toBe(true);

    const seat = await getRoomPlayerSeat(room.id, joiner.id);
    expect(seat.ready).toBe(true);

    const offP = waitForEvent(joinerClient, 'room:state');
    joinerClient.emit('room:ready', { ready: false });
    const off = await offP;
    expect(off.players.find((p) => p.playerId === joiner.id).ready).toBe(false);
  });

  it('releases the starter reservation and broadcasts on room:leave', async () => {
    const harness = await startHarness();
    const { creator, joiner, room } = await createSeatedRoom();
    const { creatorClient, joinerClient } = await seatBoth(harness, creator, joiner, room);

    const pokeId = (await pool.query('SELECT id FROM pokemons ORDER BY id LIMIT 1')).rows[0].id;
    joinerClient.emit('team:select_starter', { pokemonId: pokeId });
    await waitForEvent(joinerClient, 'room:state');

    const before = await pool.query(
      'SELECT COUNT(*)::int AS n FROM team_selections WHERE room_id = $1 AND player_id = $2',
      [room.id, joiner.id],
    );
    expect(before.rows[0].n).toBe(1);

    const stateP = waitForEvent(joinerClient, 'room:state');
    joinerClient.emit('room:leave');
    const state = await stateP;

    expect(state.players.find((p) => p.playerId === joiner.id)).toBeUndefined();
    expect(state.startersTaken).toEqual([]);

    const after = await pool.query(
      'SELECT COUNT(*)::int AS n FROM team_selections WHERE room_id = $1 AND player_id = $2',
      [room.id, joiner.id],
    );
    expect(after.rows[0].n).toBe(0);
    expect(await getRoomPlayerSeat(room.id, joiner.id)).toBeUndefined();
  });

  it('keeps the room waiting and open to new joins at one seated player', async () => {
    const harness = await startHarness();
    const { creator, joiner, room } = await createSeatedRoom();
    const { creatorClient, joinerClient } = await seatBoth(harness, creator, joiner, room);

    const stateP = waitForEvent(creatorClient, 'room:state');
    joinerClient.emit('room:leave');
    const state = await stateP;
    expect(state.status).toBe('waiting');
    expect(state.players).toHaveLength(1);
    expect(state.players[0].playerId).toBe(creator.id);

    // Spec: room "still accepts room:join" below minimum.
    const third = await createPlayer('WsRoomThird');
    const { client: thirdClient, state: thirdState } = await joinRoomViaWs(harness, third, room.code);
    expect(thirdState.status).toBe('waiting');
    expect(thirdState.players).toHaveLength(2);
    expect(thirdState.players.some((p) => p.playerId === third.id)).toBe(true);
    thirdClient.close();
  });

  it('closes the room (aborted) when the last seated player leaves', async () => {
    const harness = await startHarness();
    const { creator, joiner, room } = await createSeatedRoom();
    const { creatorClient, joinerClient } = await seatBoth(harness, creator, joiner, room);

    // Both leave: first leaves a waiting room at 1 player, second closes it.
    joinerClient.emit('room:leave');
    await waitForEvent(joinerClient, 'room:state');
    const stateP = waitForEvent(creatorClient, 'room:state');
    creatorClient.emit('room:leave');
    const state = await stateP;

    expect(state.status).toBe('aborted');
    expect(state.players).toHaveLength(0);

    const { rows } = await pool.query('SELECT status FROM rooms WHERE id = $1', [room.id]);
    expect(rows[0].status).toBe('aborted');
  });

  it('does not reset another player ready flag when a player leaves', async () => {
    const harness = await startHarness();
    const { creator, joiner, room } = await createSeatedRoom();
    const { creatorClient, joinerClient } = await seatBoth(harness, creator, joiner, room);

    creatorClient.emit('room:ready', { ready: true });
    await waitForEvent(creatorClient, 'room:state');

    const stateP = waitForEvent(creatorClient, 'room:state');
    joinerClient.emit('room:leave');
    const state = await stateP;

    expect(state.players).toHaveLength(1);
    expect(state.players[0].playerId).toBe(creator.id);
    expect(state.players[0].ready).toBe(true);

    const seat = await getRoomPlayerSeat(room.id, creator.id);
    expect(seat.ready).toBe(true);
  });

  it('closes a 1v1 room with finished duels on room:leave and emits room:final_ranking', async () => {
    const harness = await startHarness();
    const creator = await createPlayer('WsRank1Creator');
    const joiner = await createPlayer('WsRank1Joiner');
    const room = await createRoomWithCreator(2, creator.id);
    roomIds.push(room.id);
    const { client: creatorClient } = await joinRoomViaWs(harness, creator, room.code);
    const staleP = waitForEvent(creatorClient, 'room:state');
    const { client: joinerClient } = await joinRoomViaWs(harness, joiner, room.code);
    await staleP;

    // Mark the room in_progress and give it a finished duel (creator won).
    await pool.query("UPDATE rooms SET status = 'in_progress' WHERE id = $1", [room.id]);
    await pool.query(
      `INSERT INTO duels (room_id, player1_id, player2_id, round, status, winner_id, end_reason)
       VALUES ($1, $2, $3, 'unica', 'finished', $2, 'ko')`,
      [room.id, creator.id, joiner.id],
    );

    const rankingP = waitForEvent(joinerClient, 'room:final_ranking');
    joinerClient.emit('room:leave');
    const ranking = await rankingP;

    expect(ranking.roomId).toBe(room.id);
    const rank = (id) => ranking.ranking.find((r) => r.playerId === id);
    expect(rank(creator.id)).toMatchObject({ playerId: creator.id, finalRank: 1 });
    expect(rank(joiner.id)).toMatchObject({ playerId: joiner.id, finalRank: 2 });

    const { rows } = await pool.query('SELECT status FROM rooms WHERE id = $1', [room.id]);
    expect(rows[0].status).toBe('finished');
  });
});
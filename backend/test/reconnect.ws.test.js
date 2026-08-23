import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { createRoomWithCreator, getRoomPlayerSeat } from '../db/rooms.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';
import { startWsHarness, waitForEvent, waitUntil, joinRoomViaWs } from './wsHelpers.js';

/**
 * Disconnect/reconnect handling over a real Socket.IO connection (spec:
 * Disconnect Grace Window and Reconnect), exercised on real wall-clock time
 * (no fake timers, per the design's testing strategy).
 *
 * The grace window must be large enough for the whole reconnect sequence on
 * the shared Neon instance: disconnect handler (markPlayerDisconnected),
 * handshake auth (touchSession) and joinOrResumeRoom all pay ~1-2s per DB
 * round trip when the serverless instance is cold — the design's 200ms test
 * window only works against a fast local DB. 6s keeps "reconnect within the
 * window" (and "window elapsed") deterministic against that latency.
 */
const RECONNECT_GRACE_MS = 6000;

describe.skipIf(!hasDatabase)('reconnect over WS (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
    await pool.query('SELECT 1'); // warm the Neon cold start
  }, SEED_TIMEOUT);

  const roomIds = [];
  const harnesses = [];

  async function startHarness() {
    const harness = await startWsHarness({ reconnectGraceMs: RECONNECT_GRACE_MS });
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

  async function firstPokemonIds(n) {
    const { rows } = await pool.query('SELECT id FROM pokemons ORDER BY id LIMIT $1', [n]);
    return rows.map((r) => r.id);
  }

  /** Fresh room (creator pre-seated) plus both players seated over WS. */
  async function seatTwo() {
    const harness = await startHarness();
    const creator = await createPlayer('WsReconnectCreator');
    const joiner = await createPlayer('WsReconnectJoiner');
    const room = await createRoomWithCreator(4, creator.id);
    roomIds.push(room.id);
    const { client: creatorClient } = await joinRoomViaWs(harness, creator, room.code);
    // The joiner's join broadcast reaches BOTH sockets; consume the creator's
    // copy here so later waitForEvent calls never catch this stale event.
    const staleP = waitForEvent(creatorClient, 'room:state');
    const { client: joinerClient } = await joinRoomViaWs(harness, joiner, room.code);
    await staleP;
    return { harness, creator, joiner, room, creatorClient, joinerClient };
  }

  it('preserves seat, ready flag and starter reservation when reconnecting within the grace window', async () => {
    const { harness, creator, room, creatorClient } = await seatTwo();
    const [pokeId] = await firstPokemonIds(1);

    creatorClient.emit('room:ready', { ready: true });
    await waitForEvent(creatorClient, 'room:state');
    creatorClient.emit('team:select_starter', { pokemonId: pokeId });
    await waitForEvent(creatorClient, 'room:state');

    // Disconnect and wait until the server has ARMED the grace timer — the
    // resume join below must cancel an existing timer, not race its arming.
    creatorClient.disconnect();
    await waitUntil(() => harness.reconnectTimers.has(room.id, creator.id));
    const armedAt = Date.now();

    // Reconnect within the window → resume path: seat, ready and starter stay.
    const { client: reconnected, state } = await joinRoomViaWs(harness, creator, room.code);
    expect(state.players).toHaveLength(2);
    const me = state.players.find((p) => p.playerId === creator.id);
    expect(me.ready).toBe(true);
    expect(me.connected).toBe(true);
    expect(state.startersTaken).toEqual([pokeId]);

    // The resume join cancelled the timer: wait past the would-be expiry and
    // prove the seat survives (a still-pending timer would have removed it).
    const elapsed = Date.now() - armedAt;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, RECONNECT_GRACE_MS + 350 - elapsed)));
    expect(harness.reconnectTimers.has(room.id, creator.id)).toBe(false);
    const seat = await getRoomPlayerSeat(room.id, creator.id);
    expect(seat).toBeDefined();
    expect(seat.ready).toBe(true);
    expect(seat.connected).toBe(true);
    reconnected.close();
  });

  it('removes the player, releases the starter and broadcasts when the grace window elapses', async () => {
    const { creator, joiner, room, creatorClient, joinerClient } = await seatTwo();
    const [pokeId] = await firstPokemonIds(1);

    // The starter selection broadcasts to BOTH sockets; consume both copies so
    // the joiner's later wait cannot catch this stale event.
    const creatorStarterP = waitForEvent(creatorClient, 'room:state');
    const joinerStarterP = waitForEvent(joinerClient, 'room:state');
    creatorClient.emit('team:select_starter', { pokemonId: pokeId });
    await creatorStarterP;
    await joinerStarterP;

    // The joiner is the only remaining socket in the room channel; the expiry
    // broadcast (graceMs after the disconnect handler completes) is the next
    // room:state the joiner receives.
    const expiryP = waitForEvent(joinerClient, 'room:state');
    creatorClient.disconnect();
    const state = await expiryP;

    expect(state.players).toHaveLength(1);
    expect(state.players[0].playerId).toBe(joiner.id);
    expect(state.startersTaken).toEqual([]);

    const seat = await getRoomPlayerSeat(room.id, creator.id);
    expect(seat).toBeUndefined();
    const { rows } = await pool.query('SELECT status FROM rooms WHERE id = $1', [room.id]);
    expect(rows[0].status).toBe('waiting');
  });

  it('treats a reconnect after the grace window as a fresh join', async () => {
    const { harness, creator, joiner, room, creatorClient } = await seatTwo();

    creatorClient.disconnect();
    // Wait for the timer to be armed AND to fire; then poll the DB until the
    // expiry handler's leaveRoom is visible (it runs async after the timer).
    await waitUntil(() => harness.reconnectTimers.has(room.id, creator.id));
    await waitUntil(() => !harness.reconnectTimers.has(room.id, creator.id), RECONNECT_GRACE_MS * 2);
    await waitUntil(
      async () => (await getRoomPlayerSeat(room.id, creator.id)) === undefined,
      15000,
    );

    // Reconnecting now is a NEW join: fresh seat, ready reset to false.
    const { client: reconnected, state } = await joinRoomViaWs(harness, creator, room.code);
    expect(state.status).toBe('waiting');
    expect(state.players).toHaveLength(2);
    const me = state.players.find((p) => p.playerId === creator.id);
    expect(me.ready).toBe(false);
    expect(me.connected).toBe(true);

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1 AND player_id = $2',
      [room.id, creator.id],
    );
    expect(rows[0].n).toBe(1);
    reconnected.close();
  });
});
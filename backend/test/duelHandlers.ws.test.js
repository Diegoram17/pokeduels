import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { createRoomWithCreator } from '../db/rooms.js';
import { selectStarter, selectRoster } from '../db/teamSelections.js';
import { getDuelState } from '../repositories/duelRepository.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';
import { startWsHarness, waitForEvent, joinRoomViaWs } from './wsHelpers.js';
import { resetPhaseStore, getPhaseStore } from '../engine/duelPhaseStore.js';
import { resetRoundStateStore, getRoundStateStore } from '../ws/duelRoundState.js';

/**
 * End-to-end duel cycle over a real Socket.IO connection (item #5): room:ready
 * bootstrap -> duel:start -> duel:join -> select_lead -> select_action /
 * timeout -> turn_resolved -> awaiting_switch / finished. Each test runs
 * against a fresh ephemeral WS harness and a fresh room in the shared Neon
 * database. Broadcasts to `duel:{duelId}` reach every socket that joined it;
 * targeted rejections (WsError) reach only the emitting socket.
 */
describe.skipIf(!hasDatabase)('duel cycle over WS (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
    await pool.query('SELECT 1'); // warm the Neon cold start
    resetPhaseStore();
    resetRoundStateStore();
  }, SEED_TIMEOUT);

  const roomIds = [];
  const harnesses = [];

  async function startHarness(options) {
    const harness = await startWsHarness(options);
    harnesses.push(harness);
    return harness;
  }

  afterEach(async () => {
    while (harnesses.length) await harnesses.pop().teardown();
    resetPhaseStore();
    resetRoundStateStore();
  });

  afterAll(async () => {
    if (roomIds.length) {
      await pool.query('DELETE FROM rooms WHERE id = ANY($1::int[])', [roomIds]);
    }
    await pool.end();
  });

  /**
   * Two players seated over WS in a fresh 1v1 room, each with a full 6-pokemon
   * team selection inserted via the DB (starter + 5 roster). Returns both
   * clients, players, the room, and each player's team ids.
   */
  async function createSeatedAndTeamedRoom(harness) {
    const p1 = await createPlayer('DuelP1');
    const p2 = await createPlayer('DuelP2');
    const room = await createRoomWithCreator(2, p1.id);
    roomIds.push(room.id);

    const { client: c1 } = await joinRoomViaWs(harness, p1, room.code);
    const stale = waitForEvent(c1, 'room:state');
    const { client: c2 } = await joinRoomViaWs(harness, p2, room.code);
    await stale; // drain c1's copy of the joiner-join broadcast

    const pokes = (
      await pool.query('SELECT id FROM pokemons ORDER BY id LIMIT 12')
    ).rows.map((r) => r.id);
    const p1Team = pokes.slice(0, 6);
    const p2Team = pokes.slice(6, 12);
    await selectStarter(room.id, p1.id, p1Team[0]);
    await selectRoster(room.id, p1.id, p1Team.slice(1));
    await selectStarter(room.id, p2.id, p2Team[0]);
    await selectRoster(room.id, p2.id, p2Team.slice(1));

    return { p1, p2, room, c1, c2, p1Team, p2Team };
  }

  /**
   * Marks both players ready over WS: creator first (no bootstrap — only one
   * ready), joiner second (both ready -> bootstrap fires). Drains every
   * room:state broadcast on both clients so a later wait never catches a
   * stale one. Resolves with the `duel:start` payload `{ duelId }`.
   */
  async function readyBoth(ctx) {
    const { c1, c2 } = ctx;
    const startP = waitForEvent(c1, 'duel:start');

    c1.emit('room:ready', { ready: true });
    await waitForEvent(c1, 'room:state'); // c1's own ready broadcast
    await waitForEvent(c2, 'room:state'); // creator-ready broadcast to c2

    c2.emit('room:ready', { ready: true });
    await waitForEvent(c1, 'room:state'); // joiner-ready broadcast to c1
    await waitForEvent(c2, 'room:state'); // c2's own ready broadcast

    return await startP;
  }

  /** Both sockets join the duel channel; resolves with both `duel:state` snapshots. */
  async function joinDuel(ctx, duelId) {
    const { c1, c2 } = ctx;
    const s1P = waitForEvent(c1, 'duel:state');
    c1.emit('duel:join', { duelId });
    const s1 = await s1P;
    const s2P = waitForEvent(c2, 'duel:state');
    c2.emit('duel:join', { duelId });
    const s2 = await s2P;
    return { s1, s2 };
  }

  it('bootstraps a duel when both players are ready and duel:join returns a camelCase snapshot', async () => {
    const harness = await startHarness();
    const ctx = await createSeatedAndTeamedRoom(harness);
    const { duelId } = await readyBoth(ctx);

    expect(duelId).toBeGreaterThan(0);

    // DB proof: duels row, 12 seeded live states (all inactive, full HP/PP), room in_progress
    const state = await getDuelState(duelId);
    expect(state.duel.player1_id).toBe(ctx.p1.id);
    expect(state.duel.player2_id).toBe(ctx.p2.id);
    expect(state.pokemonStates).toHaveLength(12);
    expect(state.pokemonStates.every((p) => !p.is_active && !p.fainted)).toBe(true);
    expect(state.pokemonStates.every((p) => p.current_hp === 100 && p.pp_move_1 === 4)).toBe(true);
    const roomRow = (await pool.query('SELECT status FROM rooms WHERE id = $1', [ctx.room.id])).rows[0];
    expect(roomRow.status).toBe('in_progress');

    // Both join the duel channel and receive a targeted camelCase snapshot
    const { s1, s2 } = await joinDuel(ctx, duelId);
    expect(s1.duelId).toBe(duelId);
    expect(s1.turnNumber).toBe(1);
    expect(s1.pokemonStates).toHaveLength(12);
    const p1Row = s1.pokemonStates.find((p) => p.ownerId === ctx.p1.id);
    expect(p1Row).toMatchObject({
      currentHp: 100,
      ppMove1: 4,
      ppMove2: 4,
      ppMove3: 4,
      isActive: false,
      fainted: false,
    });
    expect(s2.duelId).toBe(duelId);
    expect(s2.pokemonStates.find((p) => p.ownerId === ctx.p2.id).pokemonId).toBe(ctx.p2Team[0]);
  });

  it('does not bootstrap a second duel on a repeat room:ready', async () => {
    const harness = await startHarness();
    const ctx = await createSeatedAndTeamedRoom(harness);
    const { duelId } = await readyBoth(ctx);

    const count = () =>
      pool.query('SELECT COUNT(*)::int AS n FROM duels WHERE room_id = $1', [ctx.room.id])
        .then((r) => r.rows[0].n);
    expect(await count()).toBe(1);

    // Repeat ready: the handler re-runs bootstrapDuelIfReady, which must no-op.
    const stateP = waitForEvent(ctx.c1, 'room:state');
    ctx.c1.emit('room:ready', { ready: true });
    await stateP;
    // Settle past the handler's post-broadcast bootstrap window, then prove
    // exactly one duel still exists and it is the same one.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(await count()).toBe(1);
    const { rows } = await pool.query('SELECT id FROM duels WHERE room_id = $1', [ctx.room.id]);
    expect(rows[0].id).toBe(duelId);
  });

  it('registers the WS-layer round sub-state as AWAITING_LEAD after bootstrap', async () => {
    const harness = await startHarness();
    const ctx = await createSeatedAndTeamedRoom(harness);
    const { duelId } = await readyBoth(ctx);

    // Bootstrap must NOT touch the coarse engine FSM phase — it stays pending
    // until both leads are picked (select_lead). The WS sub-state is the live
    // fine-grained signal.
    expect(getPhaseStore().get(duelId)).toBe('lead_selection');
    expect(getRoundStateStore().get(duelId)).toBe('AWAITING_LEAD');
  });
});
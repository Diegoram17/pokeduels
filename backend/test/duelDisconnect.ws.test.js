import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { createRoomWithCreator } from '../db/rooms.js';
import { selectStarter, selectRoster } from '../db/teamSelections.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';
import { startWsHarness, waitForEvent, waitUntil, joinRoomViaWs, readyAll, joinDuelChannel, selectLeads } from './wsHelpers.js';

/**
 * Mid-duel disconnect forfeit (item #6, RF-6.2) over a real Socket.IO
 * connection, mirroring reconnect.ws.test.js's real-timer harness shape. A
 * socket disconnecting while its player's duel is `in_progress` must end the
 * duel immediately (end_reason='disconnect', opponent wins) with NO 60s lobby
 * grace; a disconnect before the duel is live keeps the existing RF-2.7
 * reconnect grace; simultaneous double-disconnect yields exactly one winner
 * and exactly one `duel:finished` broadcast.
 */
const RECONNECT_GRACE_MS = 6000;

describe.skipIf(!hasDatabase)('mid-duel disconnect over WS (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
    await pool.query('SELECT 1'); // warm the Neon cold start
  }, SEED_TIMEOUT);

  const roomIds = [];
  const harnesses = [];

  async function startHarness(options) {
    const harness = await startWsHarness({ reconnectGraceMs: RECONNECT_GRACE_MS, ...options });
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

  /** Two players seated over WS in a fresh 1v1 room, each with a full team. */
  async function createSeatedAndTeamedRoom(harness) {
    const p1 = await createPlayer('DiscP1');
    const p2 = await createPlayer('DiscP2');
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
   * Full acting state: bootstrapped + joined + both leads picked (duel
   * status = in_progress). Resolves with the context plus duelId.
   */
  async function createActingDuel(harness) {
    const ctx = await createSeatedAndTeamedRoom(harness);
    const [{ duelId }] = await readyAll([ctx.c1, ctx.c2]);
    await joinDuelChannel(ctx.c1, duelId);
    await joinDuelChannel(ctx.c2, duelId);
    await selectLeads([ctx.c1, ctx.c2], duelId, [ctx.p1Team[0], ctx.p2Team[0]]);
    return { ...ctx, duelId };
  }

  /**
   * Counts server-side broadcasts of `event` across the harness Socket.IO
   * server (proves exactly-one semantics on simultaneous disconnects).
   */
  function countBroadcasts(io, event) {
    const origTo = io.to.bind(io);
    let count = 0;
    io.to = (room) => {
      const operator = origTo(room);
      const origEmit = operator.emit.bind(operator);
      operator.emit = (name, ...args) => {
        if (name === event) count += 1;
        return origEmit(name, ...args);
      };
      return operator;
    };
    return () => count;
  }

  it('forfeits immediately when a socket disconnects mid-duel: no grace timer, opponent wins', async () => {
    const harness = await startHarness({ turnTimeoutMs: 60000 });
    const { c1, c2, duelId, p1, p2, room } = await createActingDuel(harness);

    const discP = waitForEvent(c2, 'duel:opponent_disconnected', 30000);
    const finP = waitForEvent(c2, 'duel:finished', 30000);
    c1.disconnect(); // P1 forfeits by disconnecting mid-duel
    const disc = await discP;
    expect(disc).toMatchObject({ duelId });
    const fin = await finP;
    expect(fin).toMatchObject({ duelId, winnerId: p2.id, endReason: 'disconnect' });

    // No 60s reconnect grace window is armed for the forfeiting player.
    expect(harness.reconnectTimers.has(room.id, p1.id)).toBe(false);

    const { rows } = await pool.query(
      'SELECT status, winner_id, end_reason FROM duels WHERE id = $1',
      [duelId],
    );
    expect(rows[0]).toMatchObject({ status: 'finished', winner_id: p2.id, end_reason: 'disconnect' });
    // The finish cleanup removed the WS round sub-state.
    expect(harness.ctx.roundState.get(duelId)).toBeUndefined();
  }, 120000);

  it('keeps the 60s reconnect grace for a disconnect before the duel is in_progress (regression)', async () => {
    const harness = await startHarness();
    const ctx = await createSeatedAndTeamedRoom(harness);
    const [{ duelId }] = await readyAll([ctx.c1, ctx.c2]); // duel created 'pending'; no leads picked

    ctx.c1.disconnect(); // draft-phase disconnect — duel not yet live
    await waitUntil(() => harness.reconnectTimers.has(ctx.room.id, ctx.p1.id), 15000);
    expect(harness.reconnectTimers.has(ctx.room.id, ctx.p1.id)).toBe(true);

    // The pending duel is untouched: no forfeit, no winner, no finish.
    const { rows } = await pool.query(
      'SELECT status, winner_id, end_reason FROM duels WHERE id = $1',
      [duelId],
    );
    expect(rows[0].status).toBe('pending');
    expect(rows[0].winner_id).toBeNull();
    expect(rows[0].end_reason).toBeNull();
  }, 120000);

  it('simultaneous double-disconnect yields exactly one winner and one duel:finished broadcast', async () => {
    const harness = await startHarness({ turnTimeoutMs: 60000 });
    const { c1, c2, duelId, p1, p2 } = await createActingDuel(harness);

    const countFinished = countBroadcasts(harness.io, 'duel:finished');
    c1.disconnect();
    c2.disconnect();

    // Wait until the first-processed disconnect's finish is persisted.
    await waitUntil(
      () =>
        pool.query('SELECT status FROM duels WHERE id = $1', [duelId])
          .then((r) => r.rows[0].status === 'finished'),
      15000,
    );

    const { rows } = await pool.query(
      'SELECT status, winner_id, end_reason FROM duels WHERE id = $1',
      [duelId],
    );
    expect(rows[0].status).toBe('finished');
    // Exactly one winner — the opponent of whichever disconnect won the race.
    expect([p1.id, p2.id]).toContain(rows[0].winner_id);
    expect(rows[0].end_reason).toBe('disconnect');

    // The atomic conditional write is the tie-break: exactly one finish
    // broadcast, never a draw or aborted-duel state.
    expect(countFinished()).toBe(1);
  }, 120000);
});
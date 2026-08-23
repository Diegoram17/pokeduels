import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { createRoomWithCreator } from '../db/rooms.js';
import { selectStarter, selectRoster } from '../db/teamSelections.js';
import { getDuelState } from '../repositories/duelRepository.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';
import { startWsHarness, waitForEvent, waitUntil, joinRoomViaWs } from './wsHelpers.js';
import { resetPhaseStore, getPhaseStore } from '../engine/duelPhaseStore.js';
import { resetRoundStateStore, getRoundStateStore } from '../ws/duelRoundState.js';
import { resetTurnCycle } from '../ws/turnCycle.js';

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
    resetTurnCycle();
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
    resetTurnCycle();
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
  }, 90000);

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
  }, 90000);

  it('registers the WS-layer round sub-state as AWAITING_LEAD after bootstrap', async () => {
    const harness = await startHarness();
    const ctx = await createSeatedAndTeamedRoom(harness);
    const { duelId } = await readyBoth(ctx);

    // Bootstrap must NOT touch the coarse engine FSM phase — it stays pending
    // until both leads are picked (select_lead). The WS sub-state is the live
    // fine-grained signal.
    expect(getPhaseStore().get(duelId)).toBe('lead_selection');
    expect(getRoundStateStore().get(duelId)).toBe('AWAITING_LEAD');
  }, 90000);

  /**
   * Both players pick their first lead; waits until both are active in the DB
   * (light count query; generous timeout for slow Neon round trips).
   */
  async function selectLeads(ctx, duelId) {
    const { c1, c2, p1Team, p2Team } = ctx;
    c1.emit('duel:select_lead', { duelId, pokemonId: p1Team[0] });
    c2.emit('duel:select_lead', { duelId, pokemonId: p2Team[0] });
    await waitUntil(
      () =>
        pool.query(
          `SELECT COUNT(*)::int AS n FROM duel_pokemon_state
           WHERE duel_id = $1 AND is_active = TRUE`,
          [duelId],
        ).then((r) => r.rows[0].n === 2),
      20000,
    );
  }

  it('advances the duel to AWAITING_ACTIONS once both players pick a valid lead', async () => {
    const harness = await startHarness();
    const ctx = await createSeatedAndTeamedRoom(harness);
    const { duelId } = await readyBoth(ctx);

    await selectLeads(ctx, duelId);

    // DB: exactly the two picked leads are active
    const state = await getDuelState(duelId);
    expect(state.pokemonStates.filter((p) => p.is_active).map((p) => p.pokemon_id).sort((a, b) => a - b))
      .toEqual([ctx.p1Team[0], ctx.p2Team[0]].sort((a, b) => a - b));

    // WS sub-state advanced; the coarse engine FSM advanced to in_progress
    expect(getRoundStateStore().get(duelId)).toBe('AWAITING_ACTIONS');
    expect(getPhaseStore().get(duelId)).toBe('in_progress');
  }, 60000);

  it('rejects an invalid lead with duel:lead_rejected and no state change', async () => {
    const harness = await startHarness();
    const ctx = await createSeatedAndTeamedRoom(harness);
    const { duelId } = await readyBoth(ctx);

    // wrong_owner: P1 targets a pokemon owned by P2
    const rej1P = waitForEvent(ctx.c1, 'duel:lead_rejected');
    ctx.c1.emit('duel:select_lead', { duelId, pokemonId: ctx.p2Team[0] });
    const rej1 = await rej1P;
    expect(rej1.reason).toBe('wrong_owner');

    // fainted: mark P1's second team pokemon fainted, then target it
    await pool.query(
      `UPDATE duel_pokemon_state SET fainted = TRUE
       WHERE duel_id = $1 AND player_id = $2 AND pokemon_id = $3`,
      [duelId, ctx.p1.id, ctx.p1Team[1]],
    );
    const rej2P = waitForEvent(ctx.c1, 'duel:lead_rejected');
    ctx.c1.emit('duel:select_lead', { duelId, pokemonId: ctx.p1Team[1] });
    const rej2 = await rej2P;
    expect(rej2.reason).toBe('fainted');

    // no state change: nothing active, sub-state still AWAITING_LEAD
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM duel_pokemon_state
       WHERE duel_id = $1 AND is_active = TRUE`,
      [duelId],
    );
    expect(rows[0].n).toBe(0);
    expect(getRoundStateStore().get(duelId)).toBe('AWAITING_LEAD');
  }, 60000);

  it('persists a valid switch: is_active toggle + switch move row', async () => {
    const harness = await startHarness();
    const ctx = await createSeatedAndTeamedRoom(harness);
    const { duelId } = await readyBoth(ctx);
    await selectLeads(ctx, duelId);

    // P1 switches from their lead (p1Team[0]) to bench (p1Team[1])
    ctx.c1.emit('duel:switch_decision', { duelId, switchTo: ctx.p1Team[1] });
    await waitUntil(
      () =>
        pool.query(
          `SELECT COUNT(*)::int AS n FROM duel_pokemon_state
           WHERE duel_id = $1 AND player_id = $2 AND pokemon_id = $3 AND is_active = TRUE`,
          [duelId, ctx.p1.id, ctx.p1Team[1]],
        ).then((r) => r.rows[0].n === 1),
      20000,
    );

    const state = await getDuelState(duelId);
    const p1 = state.pokemonStates.filter((p) => p.player_id === ctx.p1.id);
    expect(p1.find((p) => p.pokemon_id === ctx.p1Team[0]).is_active).toBe(false);
    expect(p1.find((p) => p.pokemon_id === ctx.p1Team[1]).is_active).toBe(true);

    const { rows } = await pool.query(
      `SELECT action_type, move_index, target_pokemon_id FROM moves WHERE duel_id = $1`,
      [duelId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action_type: 'switch',
      move_index: null,
      target_pokemon_id: ctx.p1Team[0], // the previous active is the row's target
    });

    // sub-state returned to AWAITING_ACTIONS
    expect(getRoundStateStore().get(duelId)).toBe('AWAITING_ACTIONS');
  }, 60000);

  it('rejects a switch to a fainted target with duel:switch_rejected and unchanged is_active', async () => {
    const harness = await startHarness();
    const ctx = await createSeatedAndTeamedRoom(harness);
    const { duelId } = await readyBoth(ctx);
    await selectLeads(ctx, duelId);

    await pool.query(
      `UPDATE duel_pokemon_state SET fainted = TRUE
       WHERE duel_id = $1 AND player_id = $2 AND pokemon_id = $3`,
      [duelId, ctx.p1.id, ctx.p1Team[2]],
    );

    const rejP = waitForEvent(ctx.c1, 'duel:switch_rejected');
    ctx.c1.emit('duel:switch_decision', { duelId, switchTo: ctx.p1Team[2] });
    const rej = await rejP;
    expect(rej.reason).toBe('fainted');

    const state = await getDuelState(duelId);
    const p1 = state.pokemonStates.filter((p) => p.player_id === ctx.p1.id);
    expect(p1.find((p) => p.pokemon_id === ctx.p1Team[0]).is_active).toBe(true);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM moves WHERE duel_id = $1',
      [duelId],
    );
    expect(rows[0].n).toBe(0);
  }, 60000);

  /**
   * Full acting state: bootstrapped + joined + both leads picked. Resolves
   * with the joined snapshots (unused here) for symmetry with the other tests.
   */
  async function createActingDuel(harness) {
    const ctx = await createSeatedAndTeamedRoom(harness);
    const { duelId } = await readyBoth(ctx);
    await joinDuel(ctx, duelId);
    await selectLeads(ctx, duelId);
    return { ...ctx, duelId };
  }

  it('resolves a round once both players act: duel:turn_resolved with camelCase state', async () => {
    const harness = await startHarness({ turnTimeoutMs: 60000 }); // timer must not fire mid-test
    const { c1, c2, duelId, p1 } = await createActingDuel(harness);

    const resolvedP = waitForEvent(c1, 'duel:turn_resolved', 45000);
    c1.emit('duel:select_action', { duelId, moveIndex: 4 });
    c2.emit('duel:select_action', { duelId, moveIndex: 4 });
    const resolved = await resolvedP;

    expect(resolved.duelId).toBe(duelId);
    // 2 executed actions -> computed turn_number = 1 + COUNT(moves) = 3
    expect(resolved.turnNumber).toBe(3);
    expect(resolved.pokemonStates).toHaveLength(12);
    const p1Active = resolved.pokemonStates.find((x) => x.ownerId === p1.id && x.isActive);
    // move 4 (10 base dmg, no PP) always deals damage -> HP dropped from 100
    expect(p1Active.currentHp).toBeLessThan(100);
    expect(p1Active.ppMove1).toBe(4); // move 4 costs no PP

    const { rows } = await pool.query(
      'SELECT player_id, move_index, was_timeout FROM moves WHERE duel_id = $1 ORDER BY id',
      [duelId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.move_index === 4 && r.was_timeout === false)).toBe(true);

    // No KO -> sub-state back to AWAITING_ACTIONS; coarse phase unchanged
    expect(getRoundStateStore().get(duelId)).toBe('AWAITING_ACTIONS');
    expect(getPhaseStore().get(duelId)).toBe('in_progress');
  }, 120000);

  it('rejects a 0-PP action with duel:action_rejected targeted only, timer keeps running, re-pick succeeds', async () => {
    const harness = await startHarness({ turnTimeoutMs: 60000 });
    const { c1, c2, duelId, p2, p2Team } = await createActingDuel(harness);

    // P1 acts first -> arms the 10s turn timer
    c1.emit('duel:select_action', { duelId, moveIndex: 4 });
    await waitUntil(() => harness.turnTimers.has(duelId), 20000);
    expect(harness.turnTimers.has(duelId)).toBe(true);

    // P2's move 1 is spent -> targeted rejection, no buffer, no timer reset
    await pool.query(
      `UPDATE duel_pokemon_state SET pp_move_1 = 0
       WHERE duel_id = $1 AND player_id = $2 AND pokemon_id = $3`,
      [duelId, p2.id, p2Team[0]],
    );
    const rejP = waitForEvent(c2, 'duel:action_rejected', 30000);
    c2.emit('duel:select_action', { duelId, moveIndex: 1 });
    const rej = await rejP;
    expect(rej).toMatchObject({ moveIndex: 1, reason: 'insufficient_pp' });
    // the timer keeps running unaffected by the rejection
    expect(harness.turnTimers.has(duelId)).toBe(true);

    // P2 re-picks a valid move -> pair completes -> round resolves
    const resolvedP = waitForEvent(c1, 'duel:turn_resolved', 45000);
    c2.emit('duel:select_action', { duelId, moveIndex: 4 });
    const resolved = await resolvedP;
    expect(resolved.duelId).toBe(duelId);

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM moves WHERE duel_id = $1',
      [duelId],
    );
    expect(rows[0].n).toBe(2);
    expect(harness.turnTimers.has(duelId)).toBe(false); // consumed by the resolution
  }, 120000);

  it('auto-injects a timeout action for the missing player when the 10s timer expires', async () => {
    const harness = await startHarness({ turnTimeoutMs: 3000 });
    const { c1, c2, duelId, p1, p2 } = await createActingDuel(harness);

    // P1 acts; P2 never does. After the injected 3s window the timer fills
    // P2's action with {moveIndex:4, wasTimeout:true} and resolves the round.
    const resolvedP = waitForEvent(c1, 'duel:turn_resolved', 45000);
    c1.emit('duel:select_action', { duelId, moveIndex: 4 });
    const resolved = await resolvedP;
    expect(resolved.duelId).toBe(duelId);

    const { rows } = await pool.query(
      'SELECT player_id, move_index, was_timeout FROM moves WHERE duel_id = $1 ORDER BY id',
      [duelId],
    );
    expect(rows).toHaveLength(2);
    const p2Row = rows.find((r) => r.player_id === p2.id);
    expect(p2Row).toMatchObject({ move_index: 4, was_timeout: true });
    const p1Row = rows.find((r) => r.player_id === p1.id);
    expect(p1Row.was_timeout).toBe(false);
    expect(getRoundStateStore().get(duelId)).toBe('AWAITING_ACTIONS');
  }, 120000);

  it('finishes the duel when a whole team is knocked out', async () => {
    const harness = await startHarness({ turnTimeoutMs: 60000 });
    const { c1, c2, duelId, p1, p2, p1Team } = await createActingDuel(harness);

    // Bring P1's team to the brink: everything fainted except the active lead
    // at 1 HP, so ANY hit (min 5 dmg) knocks it out and wipes the team.
    await pool.query(
      `UPDATE duel_pokemon_state SET fainted = TRUE, current_hp = 0, is_active = FALSE
       WHERE duel_id = $1 AND player_id = $2`,
      [duelId, p1.id],
    );
    await pool.query(
      `UPDATE duel_pokemon_state SET fainted = FALSE, current_hp = 1, is_active = TRUE
       WHERE duel_id = $1 AND player_id = $2 AND pokemon_id = $3`,
      [duelId, p1.id, p1Team[0]],
    );

    const resolvedP = waitForEvent(c1, 'duel:turn_resolved', 45000);
    const finishedP = waitForEvent(c1, 'duel:finished', 45000);
    c1.emit('duel:select_action', { duelId, moveIndex: 4 });
    c2.emit('duel:select_action', { duelId, moveIndex: 4 });
    const resolved = await resolvedP;
    expect(resolved.duelId).toBe(duelId);

    const finished = await finishedP;
    expect(finished).toMatchObject({ duelId, winnerId: p2.id, endReason: 'ko' });

    const { rows } = await pool.query(
      'SELECT status, winner_id, end_reason FROM duels WHERE id = $1',
      [duelId],
    );
    expect(rows[0]).toMatchObject({ status: 'finished', winner_id: p2.id, end_reason: 'ko' });

    // sub-state cleaned up; coarse FSM terminal
    expect(getRoundStateStore().get(duelId)).toBeUndefined();
    expect(getPhaseStore().get(duelId)).toBe('finished');
  }, 120000);
});
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { ensureSchemaAndSeed } from './helpers.js';
import {
  getDuelState,
  applyRoundResult,
  recordMove,
  getPlayerRoster,
} from '../repositories/duelRepository.js';
import { resolverRonda } from '../engine/roundResolver.js';
import { withDuelFaultIsolation } from '../engine/faultIsolation.js';
import {
  validateSwitchDecision,
  ValidationError,
} from '../engine/switchValidation.js';
import {
  loadTypeEffectivenessCache,
  resetEffectivenessCache,
} from '../engine/typeEffectiveness.js';
import { resetPhaseStore } from '../engine/duelPhaseStore.js';

/**
 * duelRepository + resolverRonda I/O orchestrator integration tests against a
 * real Postgres/Neon branch. Gated on DATABASE_URL (no backend CI yet — local
 * runs only), mirrors test/integration.test.js: self-provisions schema + seed
 * in beforeAll and cleans up its own rows in afterAll (files run sequentially
 * per vitest.config.js, so this never races integration.test.js's migrate
 * up/down).
 */
const { Pool } = pg;
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('duelRepository + resolverRonda (requires DATABASE_URL)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  /** duel ids this file created — afterAll deletes them (cascade cleans moves/dps) */
  const createdDuelIds = [];

  /** Fetches 4 seeded pokemon rows (id + type) — robust to seed-name drift. */
  async function pickFourPokemons() {
    const { rows } = await pool.query(
      'SELECT id, type, name FROM pokemons ORDER BY id LIMIT 4',
    );
    if (rows.length < 4) {
      throw new Error('seed missing pokemons — run node seed/index.js');
    }
    return rows;
  }

  /**
   * Creates players + an in_progress duel + 4 duel_pokemon_state rows
   * (P1 active/bench, P2 active/bench) and returns the ids the tests need.
   */
  async function createDuel({
    p1ActivePp2 = 4,
    p2ActivePp2 = 4,
    p1BenchFainted = false,
  } = {}) {
    const [p1, p2] = await Promise.all([
      pool.query(`INSERT INTO players (nickname) VALUES ('DuelRepoP1') RETURNING id`),
      pool.query(`INSERT INTO players (nickname) VALUES ('DuelRepoP2') RETURNING id`),
    ]);
    const player1Id = p1.rows[0].id;
    const player2Id = p2.rows[0].id;

    const duel = await pool.query(
      `INSERT INTO duels (player1_id, player2_id, round, status)
       VALUES ($1, $2, 'unica', 'in_progress') RETURNING id`,
      [player1Id, player2Id],
    );
    const duelId = duel.rows[0].id;
    createdDuelIds.push(duelId);

    const pokemons = await pickFourPokemons();
    const [active1, bench1, active2, bench2] = pokemons;

    await pool.query(
      `INSERT INTO duel_pokemon_state
         (duel_id, player_id, pokemon_id, current_hp, pp_move_1, pp_move_2, pp_move_3, is_active, fainted)
       VALUES ($1,$2,$3,100,4,$4,4,true,false),
              ($1,$2,$5,100,4,4,4,false,$6),
              ($1,$7,$8,100,4,4,4,true,false),
              ($1,$7,$9,100,4,4,4,false,false)`,
      [
        duelId,
        player1Id,
        active1.id,
        p1ActivePp2,
        bench1.id,
        p1BenchFainted,
        player2Id,
        active2.id,
        bench2.id,
      ],
    );

    return {
      duelId,
      player1Id,
      player2Id,
      active1: { id: active1.id, type: active1.type },
      bench1: { id: bench1.id, type: bench1.type },
      active2: { id: active2.id, type: active2.type },
      bench2: { id: bench2.id, type: bench2.type },
    };
  }

  const countMoves = (duelId) =>
    pool.query('SELECT COUNT(*)::int AS n FROM moves WHERE duel_id = $1', [duelId])
      .then((r) => r.rows[0].n);

  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
    await loadTypeEffectivenessCache(pool);
    resetPhaseStore();
  });

  afterAll(async () => {
    if (createdDuelIds.length > 0) {
      await pool.query('DELETE FROM duels WHERE id = ANY($1::int[])', [createdDuelIds]);
    }
    resetEffectivenessCache();
    await pool.end();
  });

  // ---------- getDuelState ----------

  it('getDuelState returns the full canonical state: duel row, both rosters, type joined, computed turn_number', async () => {
    const { duelId, player1Id, player2Id, active1, active2 } = await createDuel();

    const state = await getDuelState(duelId);
    expect(state.duel.id).toBe(duelId);
    expect(state.duel.player1_id).toBe(player1Id);
    expect(state.duel.player2_id).toBe(player2Id);
    expect(state.duel.status).toBe('in_progress');
    // No moves yet -> turn_number computed as 1 (pure-core contract)
    expect(state.duel.turn_number).toBe(1);

    expect(state.pokemonStates).toHaveLength(4);
    expect(state.pokemonStates.every((p) => p.duel_id === duelId)).toBe(true);
    const active1Row = state.pokemonStates.find((p) => p.pokemon_id === active1.id);
    // `type` MUST be joined from pokemons (pure core feeds it to calcularDaño)
    expect(active1Row.type).toBe(active1.type);
    expect(state.pokemonStates.find((p) => p.pokemon_id === active2.id).type).toBe(active2.type);
  });

  it('getDuelState returns null (not-found signal) for an unknown duelId', async () => {
    expect(await getDuelState(99999999)).toBeNull();
  });

  it('getPlayerRoster returns only the requesting player\'s rows, with type joined', async () => {
    const { duelId, player1Id, bench1 } = await createDuel();
    const roster = await getPlayerRoster(duelId, player1Id);
    expect(roster).toHaveLength(2);
    expect(roster.every((p) => p.player_id === player1Id)).toBe(true);
    expect(roster.find((p) => p.pokemon_id === bench1.id).type).toBe(bench1.type);
    expect(await getPlayerRoster(99999999, player1Id)).toEqual([]);
  });

  // ---------- applyRoundResult ----------

  it('applyRoundResult persists state updates that are re-readable via getDuelState', async () => {
    const { duelId, active1 } = await createDuel();
    const before = await getDuelState(duelId);

    const nextState = structuredClone(before);
    const target = nextState.pokemonStates.find((p) => p.pokemon_id === active1.id);
    target.current_hp = 60; // took 40 damage
    target.pp_move_2 = 1; // used move 2 three times

    await applyRoundResult(duelId, nextState, []);

    const after = await getDuelState(duelId);
    const reRead = after.pokemonStates.find((p) => p.pokemon_id === active1.id);
    expect(reRead.current_hp).toBe(60);
    expect(reRead.pp_move_2).toBe(1);
  });

  it('applyRoundResult rolls the whole transaction back when any INSERT fails (no partial state)', async () => {
    const { duelId, active1 } = await createDuel();
    const before = await getDuelState(duelId);

    const nextState = structuredClone(before);
    const target = nextState.pokemonStates.find((p) => p.pokemon_id === active1.id);
    target.current_hp = 10;

    // effectiveness 1.5 violates the moves CHECK (2.0/1.0/0.5 only)
    const badRow = {
      duel_id: duelId,
      turn_number: 1,
      player_id: nextState.duel.player1_id,
      action_type: 'attack',
      pokemon_id: active1.id,
      move_index: 2,
      target_pokemon_id: nextState.pokemonStates.find((p) => p.pokemon_id !== active1.id).pokemon_id,
      damage_dealt: 40,
      effectiveness: 1.5,
      was_timeout: false,
    };

    await expect(applyRoundResult(duelId, nextState, [badRow])).rejects.toMatchObject({
      code: '23514',
    });

    // The UPDATE in the same transaction must have rolled back too.
    const after = await getDuelState(duelId);
    const reRead = after.pokemonStates.find((p) => p.pokemon_id === active1.id);
    expect(reRead.current_hp).toBe(100);
    expect(await countMoves(duelId)).toBe(0);
  });

  it('recordMove inserts a single moves row (shared by item #5 for switch actions)', async () => {
    const { duelId, player1Id, active1, active2 } = await createDuel();
    await recordMove({
      duel_id: duelId,
      turn_number: 1,
      player_id: player1Id,
      action_type: 'attack',
      pokemon_id: active1.id,
      move_index: 4,
      target_pokemon_id: active2.id,
      damage_dealt: 10,
      effectiveness: 1.0,
      was_timeout: false,
    });
    const { rows } = await pool.query(
      'SELECT * FROM moves WHERE duel_id = $1',
      [duelId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].move_index).toBe(4);
    expect(rows[0].action_type).toBe('attack');
  });

  // ---------- resolverRonda (I/O orchestrator) ----------

  it('resolverRonda resolves a round end-to-end and persists damage, PP, and one moves row per executed action', async () => {
    const { duelId, player1Id, player2Id, active1, active2 } = await createDuel();

    const result = await resolverRonda(
      duelId,
      { moveIndex: 2, wasTimeout: false },
      { moveIndex: 2, wasTimeout: false },
    );

    expect(result.events).toHaveLength(2);
    expect(result.events.every((e) => e.type === 'resolved')).toBe(true);
    expect(result.phase).toBe('in_progress');

    // Damage depends on the seeded type matchup (real 324-row cache), so the
    // DB HP must match the event-reported damage — not a hardcoded value.
    const p1Event = result.events.find((e) => e.playerId === player1Id);
    const p2Event = result.events.find((e) => e.playerId === player2Id);
    expect(p1Event.damage).toBeGreaterThanOrEqual(10); // floor >= 1, move 2 base 20
    expect(p1Event.effectiveness).toBeGreaterThan(0);
    expect(p2Event.damage).toBeGreaterThanOrEqual(10);

    const after = await getDuelState(duelId);
    // Each active took the opponent's event-reported damage
    expect(after.pokemonStates.find((p) => p.pokemon_id === active1.id).current_hp)
      .toBe(100 - p2Event.damage);
    expect(after.pokemonStates.find((p) => p.pokemon_id === active2.id).current_hp)
      .toBe(100 - p1Event.damage);
    // Each attacker spent 1 PP on move 2
    expect(after.pokemonStates.find((p) => p.pokemon_id === active1.id).pp_move_2).toBe(3);
    expect(after.pokemonStates.find((p) => p.pokemon_id === active2.id).pp_move_2).toBe(3);
    // One audit row per executed action, both stamped with the pre-round turn
    expect(await countMoves(duelId)).toBe(2);
    const { rows } = await pool.query(
      'SELECT player_id, turn_number FROM moves WHERE duel_id = $1 ORDER BY id',
      [duelId],
    );
    expect(new Set(rows.map((r) => r.player_id))).toEqual(new Set([player1Id, player2Id]));
    expect(rows.every((r) => r.turn_number === 1)).toBe(true);
    // Round advanced the computed turn_number. getDuelState derives it as
    // 1 + COUNT(moves) (design decision #5): 2 executed actions -> 1 + 2 = 3.
    // The formula is monotonic and collision-free even after a both-rejected
    // round (which journals zero rows), unlike MAX(turn_number)-derived values.
    expect(after.duel.turn_number).toBe(3);
  });

  it('resolverRonda never journals a rejected (insufficient_pp) action, and fault isolation reports ok:true', async () => {
    const { duelId, player1Id, player2Id, active1, active2 } = await createDuel({
      p1ActivePp2: 0, // P1's move 2 is spent -> rejection
    });

    const isolated = await withDuelFaultIsolation(duelId, () =>
      resolverRonda(
        duelId,
        { moveIndex: 2, wasTimeout: false },
        { moveIndex: 2, wasTimeout: false },
      ),
    );

    // PP rejection is expected input, NOT a fault: the wrapper reports ok:true
    expect(isolated.ok).toBe(true);
    const result = isolated.result;

    expect(result.events).toHaveLength(2);
    expect(result.events.find((e) => e.playerId === player1Id)).toMatchObject({
      type: 'rejected',
      reason: 'insufficient_pp',
    });
    expect(result.events.find((e) => e.playerId === player2Id).type).toBe('resolved');

    // Exactly ONE audit row (the resolved P2 action); the rejected one is absent
    expect(await countMoves(duelId)).toBe(1);
    const { rows } = await pool.query(
      'SELECT player_id FROM moves WHERE duel_id = $1',
      [duelId],
    );
    expect(rows[0].player_id).toBe(player2Id);

    // Asymmetric partial-round: the rejected side produced ZERO state change
    // (no damage dealt, no PP consumed), while the resolved side completed.
    const p2Event = result.events.find((e) => e.playerId === player2Id);
    const after = await getDuelState(duelId);
    expect(after.pokemonStates.find((p) => p.pokemon_id === active1.id).pp_move_2).toBe(0);
    expect(after.pokemonStates.find((p) => p.pokemon_id === active2.id).pp_move_2).toBe(3);
    // P1's rejected attack dealt nothing -> P2's active untouched...
    expect(after.pokemonStates.find((p) => p.pokemon_id === active2.id).current_hp).toBe(100);
    // ...but P2's legitimate hit landed on P1's active.
    expect(after.pokemonStates.find((p) => p.pokemon_id === active1.id).current_hp)
      .toBe(100 - p2Event.damage);
  });

  // ---------- validateSwitchDecision I/O wrapper ----------

  it('validateSwitchDecision (ID-based wrapper) accepts a legal switch from canonical DB state', async () => {
    const { duelId, player1Id, bench1 } = await createDuel();
    await expect(validateSwitchDecision(duelId, player1Id, bench1.id)).resolves.toBe(true);
  });

  it('validateSwitchDecision rejects with wrong_owner when the target is not in the player\'s roster', async () => {
    const { duelId, player1Id, active2 } = await createDuel();
    await expect(validateSwitchDecision(duelId, player1Id, active2.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(validateSwitchDecision(duelId, player1Id, active2.id)).rejects.toMatchObject({
      reason: 'wrong_owner',
    });
  });

  it('validateSwitchDecision rejects a fainted target', async () => {
    const { duelId, player1Id, bench1 } = await createDuel({ p1BenchFainted: true });
    await expect(validateSwitchDecision(duelId, player1Id, bench1.id)).rejects.toMatchObject({
      reason: 'fainted',
    });
  });

  it('validateSwitchDecision rejects an already-active target', async () => {
    const { duelId, player1Id, active1 } = await createDuel();
    await expect(validateSwitchDecision(duelId, player1Id, active1.id)).rejects.toMatchObject({
      reason: 'already_active',
    });
  });
});
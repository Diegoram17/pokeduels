import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { ensureSchemaAndSeed } from './helpers.js';
import {
  getDuelState,
  applyRoundResult,
  recordMove,
  getPlayerRoster,
  createDuelFromRoom,
  activateLead,
  applySwitchDecision,
  finishDuelWrite,
  findActiveDuelForPlayer,
  markDuelInProgress,
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
  /** room ids this file created (bootstrap tests) — afterAll deletes them (cascade cleans duels) */
  const createdRoomIds = [];

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

  /** Fetches 12 seeded pokemon rows — two full 6-pokemon team selections. */
  async function pickTwelvePokemons() {
    const { rows } = await pool.query(
      'SELECT id, type, name FROM pokemons ORDER BY id LIMIT 12',
    );
    if (rows.length < 12) {
      throw new Error('seed missing pokemons — run node seed/index.js');
    }
    return rows;
  }

  /**
   * Creates a waiting 1v1 room with two players, each with a full 6-pokemon
   * team_selections (starter + 5 roster) — the input createDuelFromRoom seeds
   * duel_pokemon_state from. Returns the room, player and team ids.
   */
  async function createRoomWithTeams() {
    const [p1, p2] = await Promise.all([
      pool.query(`INSERT INTO players (nickname) VALUES ('DuelRoomP1') RETURNING id`),
      pool.query(`INSERT INTO players (nickname) VALUES ('DuelRoomP2') RETURNING id`),
    ]);
    const player1Id = p1.rows[0].id;
    const player2Id = p2.rows[0].id;

    const code = `R${Math.random().toString(36).slice(2, 8)}`;
    const room = await pool.query(
      `INSERT INTO rooms (code, max_players, status, created_by)
       VALUES ($1, 2, 'waiting', $2) RETURNING id`,
      [code, player1Id],
    );
    const roomId = room.rows[0].id;
    createdRoomIds.push(roomId);

    const pokemons = await pickTwelvePokemons();
    const p1Team = pokemons.slice(0, 6).map((p) => p.id);
    const p2Team = pokemons.slice(6, 12).map((p) => p.id);

    const insertTeam = (playerId, team) =>
      team.map((pokemonId, i) =>
        pool.query(
          `INSERT INTO team_selections (room_id, player_id, pokemon_id, is_starter, slot)
           VALUES ($1, $2, $3, $4, $5)`,
          [roomId, playerId, pokemonId, i === 0, i + 1],
        ),
      );
    await Promise.all([...insertTeam(player1Id, p1Team), ...insertTeam(player2Id, p2Team)]);

    return { roomId, player1Id, player2Id, p1Team, p2Team };
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
    if (createdRoomIds.length > 0) {
      await pool.query('DELETE FROM rooms WHERE id = ANY($1::int[])', [createdRoomIds]);
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

  // ---------- finishDuelWrite (conditional finish UPDATE) ----------

  it('finishDuelWrite transitions an in_progress duel to finished with winner_id and end_reason', async () => {
    const { duelId, player2Id } = await createDuel();

    const result = await finishDuelWrite(duelId, player2Id, 'surrender');
    expect(result).toEqual({ applied: true });

    const after = await getDuelState(duelId);
    expect(after.duel.status).toBe('finished');
    expect(after.duel.winner_id).toBe(player2Id);
    expect(after.duel.end_reason).toBe('surrender');
  });

  it('finishDuelWrite is a no-op (applied:false) on an already-finished duel', async () => {
    const { duelId, player2Id } = await createDuel();
    await finishDuelWrite(duelId, player2Id, 'surrender');

    const result = await finishDuelWrite(duelId, player2Id, 'ko');
    expect(result).toEqual({ applied: false });

    // The first finish's values are untouched — the second write did nothing.
    const after = await getDuelState(duelId);
    expect(after.duel.status).toBe('finished');
    expect(after.duel.winner_id).toBe(player2Id);
    expect(after.duel.end_reason).toBe('surrender');
  });

  it('finishDuelWrite is idempotent — two consecutive calls, the second is a silent no-op', async () => {
    const { duelId, player1Id } = await createDuel();

    expect(await finishDuelWrite(duelId, player1Id, 'disconnect')).toEqual({ applied: true });
    expect(await finishDuelWrite(duelId, player1Id, 'disconnect')).toEqual({ applied: false });

    const after = await getDuelState(duelId);
    expect(after.duel.end_reason).toBe('disconnect');
  });

  // ---------- findActiveDuelForPlayer ----------

  it('findActiveDuelForPlayer returns the in_progress duel row for a participating player', async () => {
    const { duelId, player1Id, player2Id } = await createDuel();

    const found = await findActiveDuelForPlayer(player1Id);
    expect(found).toMatchObject({
      id: duelId,
      player1_id: player1Id,
      player2_id: player2Id,
      status: 'in_progress',
    });

    // Both participants see the same active duel.
    expect((await findActiveDuelForPlayer(player2Id)).id).toBe(duelId);
  });

  it('findActiveDuelForPlayer returns null when the player is in no in_progress duel', async () => {
    const { player1Id, player2Id } = await createDuel();
    // A non-participant has no active duel.
    const [outsider] = (await pool.query(
      `INSERT INTO players (nickname) VALUES ('DuelRepoOutsider') RETURNING id`,
    )).rows;
    expect(await findActiveDuelForPlayer(outsider.id)).toBeNull();
    expect(player1Id).not.toBe(outsider.id);
    expect(player2Id).not.toBe(outsider.id);
  });

  it('findActiveDuelForPlayer returns null once the player\'s duel is finished', async () => {
    const { duelId, player1Id, player2Id } = await createDuel();
    await finishDuelWrite(duelId, player2Id, 'surrender');

    expect(await findActiveDuelForPlayer(player1Id)).toBeNull();
    expect(await findActiveDuelForPlayer(player2Id)).toBeNull();
  });

  // ---------- markDuelInProgress (pending -> in_progress at lead-selection completion) ----------

  it('markDuelInProgress transitions a pending duel to in_progress', async () => {
    // The real app path: createDuelFromRoom inserts duels with status='pending'
    // (the WS layer writes in_progress only when both leads are picked). Mirror
    // that here rather than the createDuel() helper, which inserts in_progress
    // directly.
    const [p1, p2] = await Promise.all([
      pool.query(`INSERT INTO players (nickname) VALUES ('DuelMarkP1') RETURNING id`),
      pool.query(`INSERT INTO players (nickname) VALUES ('DuelMarkP2') RETURNING id`),
    ]);
    const { rows } = await pool.query(
      `INSERT INTO duels (player1_id, player2_id, round, status)
       VALUES ($1, $2, 'unica', 'pending') RETURNING id`,
      [p1.rows[0].id, p2.rows[0].id],
    );
    const duelId = rows[0].id;
    createdDuelIds.push(duelId);

    expect(await markDuelInProgress(duelId)).toEqual({ applied: true });

    const after = await getDuelState(duelId);
    expect(after.duel.status).toBe('in_progress');
  });

  it('markDuelInProgress is a no-op on an already-in_progress duel', async () => {
    const { duelId } = await createDuel(); // helper inserts with in_progress

    expect(await markDuelInProgress(duelId)).toEqual({ applied: false });
    expect((await getDuelState(duelId)).duel.status).toBe('in_progress');
  });

  it('markDuelInProgress is a no-op on a finished duel (never re-opens it)', async () => {
    const { duelId, player2Id } = await createDuel();
    await finishDuelWrite(duelId, player2Id, 'ko');

    expect(await markDuelInProgress(duelId)).toEqual({ applied: false });
    expect((await getDuelState(duelId)).duel.status).toBe('finished');
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

  // ---------- createDuelFromRoom (item #5 bootstrap) ----------

  it('createDuelFromRoom creates a pending duel, seeds duel_pokemon_state from team_selections, and marks the room in_progress', async () => {
    const { roomId, player1Id, player2Id, p1Team, p2Team } = await createRoomWithTeams();

    const duel = await createDuelFromRoom(roomId, player1Id, player2Id);
    createdDuelIds.push(duel.id);

    expect(duel.id).toBeGreaterThan(0);
    expect(duel.status).toBe('pending');

    const state = await getDuelState(duel.id);
    expect(state.duel.player1_id).toBe(player1Id);
    expect(state.duel.player2_id).toBe(player2Id);
    // 6 pokemon per player -> 12 seeded live-state rows
    expect(state.pokemonStates).toHaveLength(12);
    for (const p of state.pokemonStates) {
      // Full HP/PP, inactive, alive — first activation comes later via activateLead
      expect(p.current_hp).toBe(100);
      expect(p.pp_move_1).toBe(4);
      expect(p.pp_move_2).toBe(4);
      expect(p.pp_move_3).toBe(4);
      expect(p.is_active).toBe(false);
      expect(p.fainted).toBe(false);
    }
    // Seeded rows mirror each player's team selections exactly
    const p1Owned = state.pokemonStates.filter((p) => p.player_id === player1Id);
    expect(p1Owned.map((p) => p.pokemon_id).sort((a, b) => a - b))
      .toEqual([...p1Team].sort((a, b) => a - b));
    const p2Owned = state.pokemonStates.filter((p) => p.player_id === player2Id);
    expect(p2Owned.map((p) => p.pokemon_id).sort((a, b) => a - b))
      .toEqual([...p2Team].sort((a, b) => a - b));

    // Room advanced to in_progress
    const { rows } = await pool.query('SELECT status FROM rooms WHERE id = $1', [roomId]);
    expect(rows[0].status).toBe('in_progress');
  });

  it('createDuelFromRoom is idempotent — a repeat call returns the same duel without a second row', async () => {
    const { roomId, player1Id, player2Id } = await createRoomWithTeams();

    const first = await createDuelFromRoom(roomId, player1Id, player2Id);
    createdDuelIds.push(first.id);

    const second = await createDuelFromRoom(roomId, player1Id, player2Id);
    expect(second.id).toBe(first.id);

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM duels WHERE room_id = $1',
      [roomId],
    );
    expect(rows[0].n).toBe(1);
  });

  // ---------- createDuelFromRoom pair+round scoping (item #7, PR 1 rematch) ----------

  /**
   * Creates a bare room with `nPlayers` players and NO team_selections — the
   * minimal input to prove createDuelFromRoom's duel-row scoping (the
   * duel_pokemon_state seed is an empty INSERT SELECT when no teams exist,
   * which is irrelevant to the duel-row-count assertions here).
   */
  async function createBareRoom(maxPlayers, nPlayers) {
    const players = [];
    for (let i = 0; i < nPlayers; i += 1) {
      const { rows } = await pool.query(
        `INSERT INTO players (nickname) VALUES ('ScopingP${Date.now()}_${i}') RETURNING id`,
      );
      players.push(rows[0].id);
    }
    const code = `S${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await pool.query(
      `INSERT INTO rooms (code, max_players, status) VALUES ($1, $2, 'waiting') RETURNING id`,
      [code, maxPlayers],
    );
    const roomId = rows[0].id;
    createdRoomIds.push(roomId);
    return { roomId, players };
  }

  it('createDuelFromRoom creates a SECOND duel in the same room once the first is finished (rematch)', async () => {
    const { roomId, player1Id, player2Id } = await createRoomWithTeams();

    const first = await createDuelFromRoom(roomId, player1Id, player2Id);
    createdDuelIds.push(first.id);
    // The first duel resolves (finished). A finished duel must NOT block a
    // second duel for the same pair — that is the rematch enabler (PR 1).
    await pool.query(
      "UPDATE duels SET status = 'finished', winner_id = $2, end_reason = 'ko' WHERE id = $1",
      [first.id, player2Id],
    );

    const second = await createDuelFromRoom(roomId, player1Id, player2Id);
    createdDuelIds.push(second.id);

    expect(second.id).not.toBe(first.id);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM duels WHERE room_id = $1',
      [roomId],
    );
    expect(rows[0].n).toBe(2);

    // The second duel is a fresh pending duel with its own seeded state.
    const state = await getDuelState(second.id);
    expect(state.duel.status).toBe('pending');
    expect(state.pokemonStates).toHaveLength(12);
    expect(state.pokemonStates.every((p) => p.current_hp === 100 && !p.fainted)).toBe(true);
  });

  it('createDuelFromRoom scopes by round + player pair: a different pair in the same room gets its own duel', async () => {
    const { roomId, players } = await createBareRoom(4, 4);
    const [p1, p2, p3, p4] = players;

    const semiA = await createDuelFromRoom(roomId, p1, p2, 'semifinal');
    createdDuelIds.push(semiA.id);
    // Same room + same round but a DIFFERENT pair must create semiB, not return
    // semiA (the naive (room_id, round) filter would collide).
    const semiB = await createDuelFromRoom(roomId, p3, p4, 'semifinal');
    createdDuelIds.push(semiB.id);

    expect(semiB.id).not.toBe(semiA.id);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM duels WHERE room_id = $1 AND round = \'semifinal\'',
      [roomId],
    );
    expect(rows[0].n).toBe(2);
  });

  it('createDuelFromRoom returns the existing ACTIVE duel for the same pair in a different round only when the round matches', async () => {
    const { roomId, players } = await createBareRoom(4, 4);
    const [p1, p2] = players;

    const semi = await createDuelFromRoom(roomId, p1, p2, 'semifinal');
    createdDuelIds.push(semi.id);
    // The same pair requesting the SAME round returns the existing active duel.
    const semiAgain = await createDuelFromRoom(roomId, p1, p2, 'semifinal');
    expect(semiAgain.id).toBe(semi.id);

    // But a FINAL (different round) for the same pair creates a new duel.
    const final = await createDuelFromRoom(roomId, p1, p2, 'final');
    createdDuelIds.push(final.id);
    expect(final.id).not.toBe(semi.id);

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM duels WHERE room_id = $1',
      [roomId],
    );
    expect(rows[0].n).toBe(2);
  });

  // ---------- activateLead (first-activation persistence) ----------

  it('activateLead activates an owned, alive pokemon as the first active', async () => {
    const { roomId, player1Id, player2Id, p1Team } = await createRoomWithTeams();
    const duel = await createDuelFromRoom(roomId, player1Id, player2Id);
    createdDuelIds.push(duel.id);

    const row = await activateLead(duel.id, player1Id, p1Team[0]);
    expect(row.is_active).toBe(true);
    expect(row.pokemon_id).toBe(p1Team[0]);

    const state = await getDuelState(duel.id);
    const active = state.pokemonStates.filter((p) => p.is_active);
    expect(active).toHaveLength(1);
    expect(active[0].player_id).toBe(player1Id);
    expect(active[0].pokemon_id).toBe(p1Team[0]);
  });

  it('activateLead rejects a lead owned by the other player (wrong_owner) without state change', async () => {
    const { roomId, player1Id, player2Id, p1Team, p2Team } = await createRoomWithTeams();
    const duel = await createDuelFromRoom(roomId, player1Id, player2Id);
    createdDuelIds.push(duel.id);

    await expect(activateLead(duel.id, player1Id, p2Team[0])).rejects.toMatchObject({
      reason: 'wrong_owner',
    });

    const state = await getDuelState(duel.id);
    expect(state.pokemonStates.some((p) => p.is_active)).toBe(false);
  });

  it('activateLead rejects a fainted lead', async () => {
    const { roomId, player1Id, player2Id, p1Team } = await createRoomWithTeams();
    const duel = await createDuelFromRoom(roomId, player1Id, player2Id);
    createdDuelIds.push(duel.id);

    await pool.query(
      `UPDATE duel_pokemon_state SET fainted = TRUE
       WHERE duel_id = $1 AND player_id = $2 AND pokemon_id = $3`,
      [duel.id, player1Id, p1Team[1]],
    );

    await expect(activateLead(duel.id, player1Id, p1Team[1])).rejects.toMatchObject({
      reason: 'fainted',
    });
  });

  // ---------- applySwitchDecision (mid-duel switch persistence) ----------

  it('applySwitchDecision toggles is_active and journals a switch move row', async () => {
    const { duelId, player1Id, active1, bench1 } = await createDuel();

    const activated = await applySwitchDecision(duelId, player1Id, bench1.id);
    expect(activated.is_active).toBe(true);
    expect(activated.pokemon_id).toBe(bench1.id);

    const state = await getDuelState(duelId);
    const p1Rows = state.pokemonStates.filter((p) => p.player_id === player1Id);
    expect(p1Rows.find((p) => p.pokemon_id === active1.id).is_active).toBe(false);
    expect(p1Rows.find((p) => p.pokemon_id === bench1.id).is_active).toBe(true);

    const { rows } = await pool.query(
      `SELECT action_type, move_index, target_pokemon_id, turn_number, was_timeout
       FROM moves WHERE duel_id = $1`,
      [duelId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action_type: 'switch',
      move_index: null,
      target_pokemon_id: active1.id, // the previous active is the row's target
      was_timeout: false,
    });
  });

  it('applySwitchDecision rejects a fainted target and leaves is_active unchanged', async () => {
    const { duelId, player1Id, active1, bench1 } = await createDuel({ p1BenchFainted: true });

    await expect(applySwitchDecision(duelId, player1Id, bench1.id)).rejects.toMatchObject({
      reason: 'fainted',
    });

    const state = await getDuelState(duelId);
    const p1Active = state.pokemonStates.filter((p) => p.player_id === player1Id && p.is_active);
    expect(p1Active.map((p) => p.pokemon_id)).toEqual([active1.id]);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM moves WHERE duel_id = $1',
      [duelId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('applySwitchDecision rejects switching to the already-active pokemon', async () => {
    const { duelId, player1Id, active1 } = await createDuel();

    await expect(applySwitchDecision(duelId, player1Id, active1.id)).rejects.toMatchObject({
      reason: 'already_active',
    });
  });

  it('applySwitchDecision with no previous active (forced switch after KO) activates the target and journals no move row', async () => {
    const { duelId, player1Id, bench1 } = await createDuel();
    // Simulate the post-KO state: the active fainted and was deactivated.
    await pool.query(
      `UPDATE duel_pokemon_state SET is_active = FALSE, fainted = TRUE, current_hp = 0
       WHERE duel_id = $1 AND player_id = $2 AND is_active = TRUE`,
      [duelId, player1Id],
    );

    const activated = await applySwitchDecision(duelId, player1Id, bench1.id);
    expect(activated.is_active).toBe(true);

    const state = await getDuelState(duelId);
    expect(state.pokemonStates.filter((p) => p.player_id === player1Id && p.is_active))
      .toHaveLength(1);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM moves WHERE duel_id = $1',
      [duelId],
    );
    expect(rows[0].n).toBe(0);
  });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRoundLogic, resolverRonda } from '../engine/roundResolver.js';
import { createCache, resetEffectivenessCache } from '../engine/typeEffectiveness.js';
import { createPhaseStore } from '../engine/duelPhaseStore.js';

// resolverRonda (the I/O orchestrator) fetches canonical state via the
// repository and persists via applyRoundResult. For the finished-duel guard
// we mock the repository (design-authorized: no DB in a unit test — mirrors
// the turnCycle unit-test pattern) so we can prove the early return happens
// BEFORE any resolution/persistence. resolveRoundLogic (pure core) is
// untouched by this mock — it never touches the repository.
vi.mock('../repositories/duelRepository.js', () => ({
  getDuelState: vi.fn(),
  applyRoundResult: vi.fn(),
}));

import { getDuelState, applyRoundResult } from '../repositories/duelRepository.js';

// ---------- fixtures ----------

const cache = createCache([
  { attacking_type: 'normal', defending_type: 'grass', multiplier: '1.0' },
  { attacking_type: 'grass', defending_type: 'normal', multiplier: '1.0' },
  { attacking_type: 'fire', defending_type: 'grass', multiplier: '2.0' },
  { attacking_type: 'grass', defending_type: 'fire', multiplier: '0.5' },
  { attacking_type: 'normal', defending_type: 'normal', multiplier: '1.0' },
  { attacking_type: 'water', defending_type: 'fire', multiplier: '2.0' },
]);

const defaultDuel = {
  id: 1,
  player1_id: 1,
  player2_id: 2,
  status: 'in_progress',
  winner_id: null,
  end_reason: null,
  turn_number: 3,
};

const defaultPokemonStates = [
  // P1 active: normal
  { id: 10, duel_id: 1, player_id: 1, pokemon_id: 101, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: true, fainted: false, type: 'normal' },
  // P1 bench: fire
  { id: 11, duel_id: 1, player_id: 1, pokemon_id: 102, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: false, fainted: false, type: 'fire' },
  // P2 active: grass
  { id: 12, duel_id: 1, player_id: 2, pokemon_id: 201, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: true, fainted: false, type: 'grass' },
  // P2 bench: water
  { id: 13, duel_id: 1, player_id: 2, pokemon_id: 202, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: false, fainted: false, type: 'water' },
];

function makeDuelState({ duel = {}, pokemonStates } = {}) {
  return {
    duel: { ...defaultDuel, ...duel },
    pokemonStates: pokemonStates ? pokemonStates : structuredClone(defaultPokemonStates),
  };
}

function byPokemon(states, pokemonId) {
  return states.find((p) => p.pokemon_id === pokemonId);
}

const resolve = (state, a1, a2, opts = {}) =>
  resolveRoundLogic(state, a1, a2, { rng: () => 0.1, effectivenessCache: cache, ...opts });

// ---------- both actions eligible ----------

describe('random resolution order (injected rng)', () => {
  it('rng < 0.5 resolves player 1 first', () => {
    const state = makeDuelState();
    const { moveRows, events, nextDuelState } = resolve(
      state,
      { moveIndex: 2, wasTimeout: false },
      { moveIndex: 2, wasTimeout: false },
    );
    expect(moveRows[0].player_id).toBe(1);
    expect(moveRows[1].player_id).toBe(2);
    // P1 dealt 20 to P2's active, P2 dealt 20 to P1's active
    expect(byPokemon(nextDuelState.pokemonStates, 201).current_hp).toBe(80);
    expect(byPokemon(nextDuelState.pokemonStates, 101).current_hp).toBe(80);
    expect(events).toHaveLength(2);
  });

  it('rng >= 0.5 resolves player 2 first', () => {
    const state = makeDuelState();
    const { moveRows, nextDuelState } = resolve(
      state,
      { moveIndex: 2 },
      { moveIndex: 2 },
      { rng: () => 0.9 },
    );
    expect(moveRows[0].player_id).toBe(2);
    expect(moveRows[1].player_id).toBe(1);
    expect(byPokemon(nextDuelState.pokemonStates, 201).current_hp).toBe(80);
    expect(byPokemon(nextDuelState.pokemonStates, 101).current_hp).toBe(80);
  });

  it('emits exactly one event per submitted action, in submission order', () => {
    const state = makeDuelState();
    const { events } = resolve(state, { moveIndex: 2 }, { moveIndex: 2 });
    expect(events).toHaveLength(2);
    expect(events[0].playerId).toBe(1);
    expect(events[1].playerId).toBe(2);
  });

  it('resolved events carry playerId, moveIndex, damage, effectiveness, fainted', () => {
    const state = makeDuelState();
    const { events } = resolve(state, { moveIndex: 2 }, { moveIndex: 2 });
    expect(events[0]).toEqual({
      type: 'resolved',
      playerId: 1,
      moveIndex: 2,
      damage: 20,
      effectiveness: 1,
      fainted: false,
    });
  });

  it('decrements PP for moves 1-3 after execution', () => {
    const state = makeDuelState();
    const { nextDuelState } = resolve(state, { moveIndex: 1 }, { moveIndex: 3 });
    expect(byPokemon(nextDuelState.pokemonStates, 101).pp_move_1).toBe(3);
    expect(byPokemon(nextDuelState.pokemonStates, 201).pp_move_3).toBe(3);
  });

  it('move 4 deals damage but never decrements PP', () => {
    const state = makeDuelState();
    const { nextDuelState, events } = resolve(
      state,
      { moveIndex: 4 },
      { moveIndex: 2 },
    );
    expect(events[0].type).toBe('resolved');
    expect(events[0].damage).toBe(10); // base 10, neutral
    expect(byPokemon(nextDuelState.pokemonStates, 201).current_hp).toBe(90);
    // P2's move 2 costs PP; P1's move 4 has no PP column to decrement
    expect(byPokemon(nextDuelState.pokemonStates, 201).pp_move_2).toBe(3);
    expect(byPokemon(nextDuelState.pokemonStates, 101).pp_move_2).toBe(4);
  });

  it('reports super-effective effectiveness in the event and the row', () => {
    const state = makeDuelState({
      pokemonStates: [
        { id: 10, duel_id: 1, player_id: 1, pokemon_id: 101, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: true, fainted: false, type: 'fire' },
        ...defaultPokemonStates.slice(1),
      ],
    });
    const { events, moveRows } = resolve(
      state,
      { moveIndex: 1 }, // 25 x 2.0 vs grass = 50
      { moveIndex: 2 },
    );
    expect(events[0]).toMatchObject({ damage: 50, effectiveness: 2 });
    expect(moveRows[0].effectiveness).toBe(2);
    expect(moveRows[0].damage_dealt).toBe(50);
  });
});

// ---------- PP rejection ----------

describe('insufficient PP rejection (design amendment)', () => {
  it('rejects with {type:"rejected", reason:"insufficient_pp"} when chosen move has 0 PP', () => {
    const state = makeDuelState({
      pokemonStates: defaultPokemonStates.map((p) =>
        p.pokemon_id === 101 ? { ...p, pp_move_2: 0 } : p,
      ),
    });
    const { events } = resolve(state, { moveIndex: 2 }, { moveIndex: 2 });
    expect(events[0]).toEqual({
      type: 'rejected',
      playerId: 1,
      moveIndex: 2,
      reason: 'insufficient_pp',
    });
  });

  it('mutates no HP and no PP for the rejected action', () => {
    const state = makeDuelState({
      pokemonStates: defaultPokemonStates.map((p) =>
        p.pokemon_id === 101 ? { ...p, pp_move_2: 0 } : p,
      ),
    });
    const { nextDuelState } = resolve(state, { moveIndex: 2 }, { moveIndex: 2 });
    const p1Active = byPokemon(nextDuelState.pokemonStates, 101);
    // rejected action itself: PP untouched (was 0, stays 0 — never decremented)
    expect(p1Active.pp_move_2).toBe(0);
    // rejected action dealt no damage: P2's active untouched (P2's own attack
    // only damages P1's active — asserted in the partial-round test)
    expect(byPokemon(nextDuelState.pokemonStates, 201).current_hp).toBe(100);
  });

  it('writes no moveRows entry for the rejected action', () => {
    const state = makeDuelState({
      pokemonStates: defaultPokemonStates.map((p) =>
        p.pokemon_id === 101 ? { ...p, pp_move_2: 0 } : p,
      ),
    });
    const { moveRows } = resolve(state, { moveIndex: 2 }, { moveIndex: 2 });
    expect(moveRows).toHaveLength(1);
    expect(moveRows[0].player_id).toBe(2);
  });

  it('completes the round partially — rejected side unchanged, other side resolves', () => {
    const state = makeDuelState({
      pokemonStates: defaultPokemonStates.map((p) =>
        p.pokemon_id === 101 ? { ...p, pp_move_2: 0 } : p,
      ),
    });
    const { events, nextDuelState, nextPhase } = resolve(
      state,
      { moveIndex: 2 },
      { moveIndex: 2 },
    );
    expect(events[0].type).toBe('rejected');
    expect(events[1]).toEqual({
      type: 'resolved',
      playerId: 2,
      moveIndex: 2,
      damage: 20,
      effectiveness: 1,
      fainted: false,
    });
    // P2's attack landed on P1's active
    expect(byPokemon(nextDuelState.pokemonStates, 101).current_hp).toBe(80);
    // P2's own pokemon untouched
    expect(byPokemon(nextDuelState.pokemonStates, 201).current_hp).toBe(100);
    expect(nextPhase).toBe('in_progress');
  });

  it('both actions rejected — no state change, empty moveRows, round still processed', () => {
    const state = makeDuelState({
      pokemonStates: defaultPokemonStates.map((p) =>
        p.pokemon_id === 101 || p.pokemon_id === 201 ? { ...p, pp_move_2: 0 } : p,
      ),
    });
    const { events, moveRows, nextDuelState, nextPhase } = resolve(
      state,
      { moveIndex: 2 },
      { moveIndex: 2 },
    );
    expect(events).toEqual([
      { type: 'rejected', playerId: 1, moveIndex: 2, reason: 'insufficient_pp' },
      { type: 'rejected', playerId: 2, moveIndex: 2, reason: 'insufficient_pp' },
    ]);
    expect(moveRows).toEqual([]);
    expect(byPokemon(nextDuelState.pokemonStates, 101).current_hp).toBe(100);
    expect(byPokemon(nextDuelState.pokemonStates, 201).current_hp).toBe(100);
    expect(nextPhase).toBe('in_progress');
  });

  it('move 4 is never rejected for insufficient PP, regardless of other PP state', () => {
    const state = makeDuelState({
      pokemonStates: defaultPokemonStates.map((p) =>
        p.pokemon_id === 101 ? { ...p, pp_move_1: 0, pp_move_2: 0, pp_move_3: 0 } : p,
      ),
    });
    const { events } = resolve(state, { moveIndex: 4 }, { moveIndex: 2 });
    expect(events[0].type).toBe('resolved');
    expect(events[0].damage).toBe(10);
  });

  it('does not invoke rng when only one action is eligible (rejected excluded from ordering)', () => {
    const state = makeDuelState({
      pokemonStates: defaultPokemonStates.map((p) =>
        p.pokemon_id === 101 ? { ...p, pp_move_2: 0 } : p,
      ),
    });
    const rng = vi.fn(() => 0.1);
    resolveRoundLogic(state, { moveIndex: 2 }, { moveIndex: 2 }, {
      rng,
      effectivenessCache: cache,
    });
    expect(rng).not.toHaveBeenCalled();
  });
});

// ---------- skip after KO / finish ----------

describe('knockout handling', () => {
  const fireP1 = makeDuelState({
    pokemonStates: [
      { id: 10, duel_id: 1, player_id: 1, pokemon_id: 101, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: true, fainted: false, type: 'fire' },
      ...defaultPokemonStates.slice(1),
    ],
  });

  it('skips the second action when the first knocks out its actor\'s active pokemon', () => {
    // P2 active pre-damaged to 30; P1 fire move 1 = 25 x 2.0 = 50 -> KO
    const state = makeDuelState({
      ...fireP1.duel,
      pokemonStates: fireP1.pokemonStates.map((p) =>
        p.pokemon_id === 201 ? { ...p, current_hp: 30 } : p,
      ),
    });
    const { events, moveRows, nextDuelState, nextPhase } = resolve(
      state,
      { moveIndex: 1 },
      { moveIndex: 2 },
    );
    expect(events[0]).toEqual({
      type: 'resolved',
      playerId: 1,
      moveIndex: 1,
      damage: 50,
      effectiveness: 2,
      fainted: true,
    });
    expect(events[1]).toEqual({
      type: 'skipped',
      playerId: 2,
      reason: 'target_fainted',
    });
    // KO bookkeeping
    const p2Active = byPokemon(nextDuelState.pokemonStates, 201);
    expect(p2Active.current_hp).toBe(0);
    expect(p2Active.fainted).toBe(true);
    expect(p2Active.is_active).toBe(false);
    // P2's skipped action still gets an audit row (NULL damage/effectiveness)
    expect(moveRows).toHaveLength(2);
    expect(moveRows[1]).toMatchObject({
      player_id: 2,
      action_type: 'attack',
      move_index: 2,
      damage_dealt: null,
      effectiveness: null,
    });
    expect(nextPhase).toBe('in_progress'); // P2 bench (202) still alive
  });

  it('clamps HP at 0 and marks fainted/is_active on a KO', () => {
    const state = makeDuelState({
      duel: {},
      pokemonStates: [
        { id: 10, duel_id: 1, player_id: 1, pokemon_id: 101, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: true, fainted: false, type: 'fire' },
        ...defaultPokemonStates.slice(1),
      ].map((p) => (p.pokemon_id === 201 ? { ...p, current_hp: 10 } : p)),
    });
    const { nextDuelState } = resolve(state, { moveIndex: 1 }, { moveIndex: 2 });
    const p2Active = byPokemon(nextDuelState.pokemonStates, 201);
    expect(p2Active.current_hp).toBe(0); // clamped, never negative
    expect(p2Active.fainted).toBe(true);
    expect(p2Active.is_active).toBe(false);
  });

  it('finishes the duel when the KO leaves a player with no non-fainted pokemon', () => {
    const state = makeDuelState({
      duel: {},
      pokemonStates: [
        { id: 10, duel_id: 1, player_id: 1, pokemon_id: 101, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: true, fainted: false, type: 'fire' },
        { id: 11, duel_id: 1, player_id: 1, pokemon_id: 102, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: false, fainted: false, type: 'fire' },
        { id: 12, duel_id: 1, player_id: 2, pokemon_id: 201, current_hp: 30, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: true, fainted: false, type: 'grass' },
        { id: 13, duel_id: 1, player_id: 2, pokemon_id: 202, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: false, fainted: true, type: 'water' },
      ],
    });
    const { nextDuelState, nextPhase, events } = resolve(
      state,
      { moveIndex: 1 },
      { moveIndex: 2 },
    );
    expect(events[1].type).toBe('skipped');
    expect(nextDuelState.duel.status).toBe('finished');
    expect(nextDuelState.duel.winner_id).toBe(1);
    expect(nextDuelState.duel.end_reason).toBe('ko');
    expect(nextPhase).toBe('finished');
  });

  it('does not finish the duel while a bench pokemon remains', () => {
    // P2 bench (202) alive -> no finish even after active KO
    const state = makeDuelState({
      pokemonStates: [
        { id: 10, duel_id: 1, player_id: 1, pokemon_id: 101, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: true, fainted: false, type: 'fire' },
        ...defaultPokemonStates.slice(1),
      ].map((p) => (p.pokemon_id === 201 ? { ...p, current_hp: 30 } : p)),
    });
    const { nextDuelState, nextPhase } = resolve(
      state,
      { moveIndex: 1 },
      { moveIndex: 2 },
    );
    expect(nextDuelState.duel.status).toBe('in_progress');
    expect(nextDuelState.duel.winner_id).toBeNull();
    expect(nextPhase).toBe('in_progress');
  });
});

// ---------- audit rows / purity ----------

describe('moveRows audit contract', () => {
  it('stamps was_timeout from the action', () => {
    const state = makeDuelState();
    const { moveRows } = resolve(
      state,
      { moveIndex: 2 },
      { moveIndex: 2, wasTimeout: true },
    );
    expect(moveRows[1].was_timeout).toBe(true);
    expect(moveRows[0].was_timeout).toBe(false);
  });

  it('stamps turn_number from duel state and advances it in nextDuelState', () => {
    const state = makeDuelState(); // turn_number: 3
    const { moveRows, nextDuelState } = resolve(
      state,
      { moveIndex: 2 },
      { moveIndex: 2 },
    );
    expect(moveRows[0].turn_number).toBe(3);
    expect(moveRows[1].turn_number).toBe(3);
    expect(nextDuelState.duel.turn_number).toBe(4);
  });

  it('carries duel_id, player_id, pokemon_id and target_pokemon_id', () => {
    const state = makeDuelState();
    const { moveRows } = resolve(state, { moveIndex: 2 }, { moveIndex: 2 });
    expect(moveRows[0]).toMatchObject({
      duel_id: 1,
      player_id: 1,
      pokemon_id: 101,
      target_pokemon_id: 201,
      action_type: 'attack',
      move_index: 2,
    });
  });
});

describe('purity', () => {
  it('does not mutate the caller-supplied duelState', () => {
    const state = makeDuelState();
    const before = JSON.stringify(state);
    resolve(state, { moveIndex: 2 }, { moveIndex: 2 });
    expect(JSON.stringify(state)).toBe(before);
  });
});

// ---------- resolverRonda finished-duel guard ----------

describe('resolverRonda finished-duel guard', () => {
  let phaseStore;

  beforeEach(() => {
    vi.clearAllMocks();
    resetEffectivenessCache();
    phaseStore = createPhaseStore();
    vi.spyOn(phaseStore, 'set');
  });

  it('throws when phaseStore is not injected (required dependency, A1-3b)', async () => {
    // The I/O orchestrator must fail loudly on any missed call site once the
    // getPhaseStore() singleton shim is deleted (design Q6).
    await expect(resolverRonda(7, { moveIndex: 4 }, { moveIndex: 4 })).rejects.toThrow(
      'resolverRonda requires an injected phaseStore',
    );
  });

  it('returns {applied:false} without resolving or persisting when the duel status is not in_progress', async () => {
    // A duel already ended by surrender/disconnect — a stray timer fires again.
    getDuelState.mockResolvedValue({
      duel: { id: 7, player1_id: 1, player2_id: 2, status: 'finished', winner_id: 2, end_reason: 'surrender', turn_number: 5 },
      pokemonStates: [],
    });

    const result = await resolverRonda(7, { moveIndex: 4 }, { moveIndex: 4 }, { phaseStore });

    expect(result).toEqual({ applied: false });
    // The resolution/persistence path was never entered: no round persisted
    // (no moves row), no duel_pokemon_state mutation, no FSM advance.
    expect(applyRoundResult).not.toHaveBeenCalled();
    expect(phaseStore.set).not.toHaveBeenCalled();
  });

  it('does not call resolveRoundLogic on a finished duel (guard fires before resolution)', async () => {
    // Guard must return before the pure core runs. Because resolverRonda calls
    // resolveRoundLogic internally (not injectable), we prove the bypass by
    // ensuring nothing downstream of it ran: getEffectivenessCache would be
    // reached only if resolveRoundLogic were about to run — so we assert the
    // repository's applyRoundResult (which resolveRoundLogic's result feeds)
    // was never reached.
    getDuelState.mockResolvedValue({
      duel: { id: 8, player1_id: 1, player2_id: 2, status: 'finished', winner_id: 1, end_reason: 'ko', turn_number: 9 },
      pokemonStates: [],
    });

    const result = await resolverRonda(8, { moveIndex: 2 }, { moveIndex: 2 }, { phaseStore });
    expect(result).toEqual({ applied: false });
    expect(applyRoundResult).not.toHaveBeenCalled();
  });

  it('still throws for a missing duel (guard only short-circuits non-in_progress, not not-found)', async () => {
    getDuelState.mockResolvedValue(null);
    await expect(
      resolverRonda(999, { moveIndex: 4 }, { moveIndex: 4 }, { phaseStore }),
    ).rejects.toThrow('not found');
  });
});

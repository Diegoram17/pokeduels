import { describe, it, expect } from 'vitest';
import {
  mapDuelStateToCamelCase,
  mapRoundEventsToCamelCase,
} from '../repositories/duelStateMapper.js';

// Pure mapping tests (item #5): mapDuelStateToCamelCase transforms the
// canonical snake_case repository state into the camelCase shape the frontend
// DuelState/DuelPokemonState schema expects (frontend/src/state/schema.ts),
// so #9/#10 can consume duel payloads without server-side per-client work.
const snakeState = {
  duel: {
    id: 42,
    player1_id: 1,
    player2_id: 2,
    status: 'in_progress',
    winner_id: null,
    end_reason: null,
    turn_number: 3,
  },
  pokemonStates: [
    {
      id: 10,
      duel_id: 42,
      player_id: 1,
      pokemon_id: 101,
      current_hp: 80,
      pp_move_1: 3,
      pp_move_2: 4,
      pp_move_3: 4,
      is_active: true,
      fainted: false,
      type: 'normal',
    },
    {
      id: 11,
      duel_id: 42,
      player_id: 2,
      pokemon_id: 201,
      current_hp: 0,
      pp_move_1: 0,
      pp_move_2: 0,
      pp_move_3: 0,
      is_active: false,
      fainted: true,
      type: 'fire',
    },
  ],
};

describe('mapDuelStateToCamelCase', () => {
  it('maps the duel row to the camelCase DuelState shape', () => {
    const mapped = mapDuelStateToCamelCase(snakeState);

    expect(mapped.duelId).toBe(42);
    expect(mapped.turnNumber).toBe(3);
    expect(mapped.winnerId).toBeNull();
    expect(mapped.endReason).toBeNull();
  });

  it('maps every pokemon row to the camelCase DuelPokemonState shape', () => {
    const mapped = mapDuelStateToCamelCase(snakeState);

    expect(mapped.pokemonStates).toHaveLength(2);
    const p1 = mapped.pokemonStates.find((p) => p.ownerId === 1);
    expect(p1).toMatchObject({
      duelId: 42,
      ownerId: 1,
      pokemonId: 101,
      currentHp: 80,
      ppMove1: 3,
      ppMove2: 4,
      ppMove3: 4,
      isActive: true,
      fainted: false,
      type: 'normal',
    });
  });

  it('preserves a finished duel winner/end reason', () => {
    const finished = structuredClone(snakeState);
    finished.duel.status = 'finished';
    finished.duel.winner_id = 1;
    finished.duel.end_reason = 'ko';

    const mapped = mapDuelStateToCamelCase(finished);
    expect(mapped.winnerId).toBe(1);
    expect(mapped.endReason).toBe('ko');
  });

  it('maps a fainted pokemon with spent PP faithfully', () => {
    const mapped = mapDuelStateToCamelCase(snakeState);
    const p2 = mapped.pokemonStates.find((p) => p.ownerId === 2);
    expect(p2).toMatchObject({
      pokemonId: 201,
      currentHp: 0,
      ppMove1: 0,
      ppMove2: 0,
      ppMove3: 0,
      isActive: false,
      fainted: true,
    });
  });

  it('does not mutate the canonical snake_case state', () => {
    const before = JSON.stringify(snakeState);
    mapDuelStateToCamelCase(snakeState);
    expect(JSON.stringify(snakeState)).toBe(before);
  });
});

// Pure mapping tests (Fase 7, PR7): mapRoundEventsToCamelCase turns the
// engine's round `events` list (backend/engine/roundResolver.js —
// { resolved, skipped, rejected }) into the additive `turnEvents` payload
// field of duel:turn_resolved, preserving the exact server resolution order.
describe('mapRoundEventsToCamelCase', () => {
  it('picks exactly the seven payload fields per event, defaulting the absent ones', () => {
    const events = [
      { type: 'resolved', playerId: 2, moveIndex: 2, damage: 25, effectiveness: 1, fainted: false },
      { type: 'skipped', playerId: 1, reason: 'target_fainted' },
      { type: 'rejected', playerId: 2, moveIndex: 1, reason: 'insufficient_pp' },
    ];

    const mapped = mapRoundEventsToCamelCase(events);

    expect(mapped).toEqual([
      { type: 'resolved', playerId: 2, moveIndex: 2, damage: 25, effectiveness: 1, fainted: false, reason: null },
      { type: 'skipped', playerId: 1, moveIndex: null, damage: null, effectiveness: null, fainted: false, reason: 'target_fainted' },
      { type: 'rejected', playerId: 2, moveIndex: 1, damage: null, effectiveness: null, fainted: false, reason: 'insufficient_pp' },
    ]);
  });

  it('preserves the server resolution order', () => {
    const events = [
      { type: 'resolved', playerId: 2, moveIndex: 4, damage: 10, effectiveness: 1, fainted: false },
      { type: 'resolved', playerId: 1, moveIndex: 2, damage: 20, effectiveness: 2, fainted: true },
    ];

    const mapped = mapRoundEventsToCamelCase(events);

    expect(mapped.map((e) => e.playerId)).toEqual([2, 1]);
    expect(mapped[0].fainted).toBe(false);
    expect(mapped[1].fainted).toBe(true);
  });

  it('passes the rejection/skip reason through unchanged', () => {
    const events = [
      { type: 'rejected', playerId: 1, moveIndex: 3, reason: 'insufficient_pp' },
      { type: 'skipped', playerId: 2, reason: 'target_fainted' },
    ];

    const mapped = mapRoundEventsToCamelCase(events);

    expect(mapped[0].reason).toBe('insufficient_pp');
    expect(mapped[1].reason).toBe('target_fainted');
  });

  it('returns an empty array for a non-array input (resolverRonda no-op path)', () => {
    expect(mapRoundEventsToCamelCase(undefined)).toEqual([]);
    expect(mapRoundEventsToCamelCase(null)).toEqual([]);
    expect(mapRoundEventsToCamelCase([])).toEqual([]);
  });
});
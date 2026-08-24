import { describe, it, expect } from 'vitest';
import { mapDuelStateToCamelCase } from '../repositories/duelRepository.js';

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
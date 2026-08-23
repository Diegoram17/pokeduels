import { describe, it, expect } from 'vitest';
import { calcularDaño } from '../engine/damageCalc.js';
import { MOVE_DAMAGE, MOVE_PP } from '../engine/constants.js';
import { createCache } from '../engine/typeEffectiveness.js';

const cache = createCache([
  { attacking_type: 'normal', defending_type: 'normal', multiplier: '1.0' },
  { attacking_type: 'fire', defending_type: 'grass', multiplier: '2.0' },
  { attacking_type: 'fire', defending_type: 'fire', multiplier: '0.5' },
]);

describe('constants', () => {
  it('defines 1-indexed move base damage 25/20/15/10', () => {
    expect(MOVE_DAMAGE).toEqual({ 1: 25, 2: 20, 3: 15, 4: 10 });
  });

  it('defines 1-indexed move PP with move 4 unlimited', () => {
    expect(MOVE_PP[1]).toBe(4);
    expect(MOVE_PP[2]).toBe(4);
    expect(MOVE_PP[3]).toBe(4);
    expect(MOVE_PP[4]).toBe(Infinity);
  });
});

describe('calcularDaño', () => {
  it('returns base damage for a neutral (1.0) matchup', () => {
    const damage = calcularDaño({
      attackerType: 'normal',
      defenderType: 'normal',
      moveIndex: 1,
      effectivenessCache: cache,
    });
    expect(damage).toBe(25);
  });

  it('floors super-effective damage (2.0 x base 15 = 30)', () => {
    const damage = calcularDaño({
      attackerType: 'fire',
      defenderType: 'grass',
      moveIndex: 3,
      effectivenessCache: cache,
    });
    expect(damage).toBe(30);
  });

  it('applies a not-very-effective multiplier (0.5 x base 10 = 5)', () => {
    const damage = calcularDaño({
      attackerType: 'fire',
      defenderType: 'fire',
      moveIndex: 4,
      effectivenessCache: cache,
    });
    expect(damage).toBe(5);
  });

  it('never returns less than 1 damage, even when floored below 1', () => {
    const tiny = createCache([
      { attacking_type: 'fire', defending_type: 'water', multiplier: '0.09' },
    ]);
    // 10 * 0.09 = 0.9 -> floor 0 -> clamped to 1
    const damage = calcularDaño({
      attackerType: 'fire',
      defenderType: 'water',
      moveIndex: 4,
      effectivenessCache: tiny,
    });
    expect(damage).toBe(1);
  });

  it('throws when no multiplier is defined for the type pair', () => {
    const sparse = createCache();
    expect(() =>
      calcularDaño({
        attackerType: 'ghost',
        defenderType: 'normal',
        moveIndex: 1,
        effectivenessCache: sparse,
      }),
    ).toThrow(/No type-effectiveness multiplier/);
  });

  it('throws for an out-of-range move index', () => {
    expect(() =>
      calcularDaño({
        attackerType: 'normal',
        defenderType: 'normal',
        moveIndex: 5,
        effectivenessCache: cache,
      }),
    ).toThrow(/moveIndex/);
  });
});
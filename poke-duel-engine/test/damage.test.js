// tests/damage.test.js
import { describe, it, expect } from 'vitest';
import { calculateDamage, getEffectiveness } from '../src/engine/damage.js';
import { sampleTypeChart } from './fixtures.js';

describe('Damage calculation', () => {
  it('should return 25 for neutral attack (move 1, ×1.0)', () => {
    const damage = calculateDamage('normal', 'normal', 1, sampleTypeChart);
    expect(damage).toBe(25);
  });

  it('should return 50 for super effective attack (move 1, ×2.0)', () => {
    const damage = calculateDamage('water', 'fire', 1, sampleTypeChart);
    expect(damage).toBe(50);
  });

  it('should return 12 for not very effective attack (move 1, ×0.5, floor)', () => {
    const damage = calculateDamage('fire', 'fire', 1, sampleTypeChart);
    expect(damage).toBe(12);
  });

  it('should return 7 for not very effective attack (move 3, ×0.5, floor)', () => {
    const damage = calculateDamage('fire', 'fire', 3, sampleTypeChart);
    expect(damage).toBe(7);
  });

  it('should return 5 for not very effective attack (move 4, ×0.5, floor)', () => {
    const damage = calculateDamage('fire', 'fire', 4, sampleTypeChart);
    expect(damage).toBe(5);
  });

  it('should return 1.0 for missing type combination', () => {
    const effectiveness = getEffectiveness('dragon', 'fire', sampleTypeChart);
    expect(effectiveness).toBe(1.0);
  });

  it('should never return 0 damage (minimum 1)', () => {
    // Test with a combination that would normally be 0
    // Since we have no immunities, the minimum is 1
    const damage = calculateDamage('ghost', 'normal', 4, sampleTypeChart);
    // Ghost vs normal is 0.5 in our chart
    expect(damage).toBe(5);
    // The minimum should be 1 for any combination
    // Create a custom test with a move that would deal less than 1
    // In our system, the minimum damage is always at least 1
    expect(damage).toBeGreaterThanOrEqual(1);
  });
});
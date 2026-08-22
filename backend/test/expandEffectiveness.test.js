import { describe, it, expect } from 'vitest';
import { expandEffectiveness } from '../seed/expandEffectiveness.js';
import { CANONICAL_TYPES } from '../seed/canonicalTypes.js';

const TYPES = ['normal', 'fire', 'water', 'grass', 'ghost', 'electric'];

const sparse = [
  { attacking_type: 'fire', defending_type: 'fire', multiplier: 0.5 },
  { attacking_type: 'fire', defending_type: 'water', multiplier: 0.5 },
  { attacking_type: 'fire', defending_type: 'grass', multiplier: 2.0 },
  { attacking_type: 'electric', defending_type: 'electric', multiplier: 0.5 },
];

describe('expandEffectiveness', () => {
  it('expands the sparse rows to one row per ordered pair (n x n)', () => {
    const rows = expandEffectiveness(sparse, TYPES);
    expect(rows).toHaveLength(TYPES.length * TYPES.length); // 6 x 6 = 36

    const pairKeys = new Set(rows.map((r) => `${r.attacking_type}|${r.defending_type}`));
    expect(pairKeys.size).toBe(36); // every ordered pair appears exactly once
  });

  it('defaults an uncurated pair to neutral 1.0', () => {
    const rows = expandEffectiveness(sparse, TYPES);
    const ghostNormal = rows.find((r) => r.attacking_type === 'ghost' && r.defending_type === 'normal');
    expect(ghostNormal.multiplier).toBe(1.0);
  });

  it('passes curated self-pairs through unchanged', () => {
    const rows = expandEffectiveness(sparse, TYPES);
    const fireFire = rows.find((r) => r.attacking_type === 'fire' && r.defending_type === 'fire');
    expect(fireFire.multiplier).toBe(0.5);
  });

  it('preserves curated non-self pairs', () => {
    const rows = expandEffectiveness(sparse, TYPES);
    const fireGrass = rows.find((r) => r.attacking_type === 'fire' && r.defending_type === 'grass');
    expect(fireGrass.multiplier).toBe(2.0);
  });

  it('expands to the full 324 ordered pairs over the 18 canonical types', () => {
    const rows = expandEffectiveness(sparse, CANONICAL_TYPES);
    expect(rows).toHaveLength(18 * 18);

    const attacking = new Set(rows.map((r) => r.attacking_type));
    const defending = new Set(rows.map((r) => r.defending_type));
    expect(attacking.size).toBe(18);
    expect(defending.size).toBe(18);
  });
});
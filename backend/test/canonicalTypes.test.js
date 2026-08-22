import { describe, it, expect } from 'vitest';
import { CANONICAL_TYPES, validateType } from '../seed/canonicalTypes.js';

const EXPECTED_ORDER = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark',
  'steel', 'fairy',
];

describe('CANONICAL_TYPES', () => {
  it('contains exactly the 18 canonical types in the documented order', () => {
    expect(CANONICAL_TYPES).toEqual(EXPECTED_ORDER);
  });

  it('has no duplicate entries', () => {
    expect(new Set(CANONICAL_TYPES).size).toBe(CANONICAL_TYPES.length);
  });
});

describe('validateType', () => {
  it('accepts any canonical type and returns it', () => {
    expect(validateType('fire')).toBe('fire');
    expect(validateType('fairy')).toBe('fairy');
  });

  it('throws loudly on a type outside the canonical 18', () => {
    expect(() => validateType('cosmic')).toThrow(/cosmic/);
  });
});
import { describe, it, expect } from 'vitest';
import { assertSeedCounts } from '../seed/assertions.js';

const OK = {
  types: 18,
  pokemons: 54,
  effectiveness: 324,
  attackingTypes: 18,
  defendingTypes: 18,
};

describe('assertSeedCounts', () => {
  it('returns true when every count matches the expected seed', () => {
    expect(assertSeedCounts(OK)).toBe(true);
  });

  it('throws with an explicit row-count error when types is wrong', () => {
    expect(() => assertSeedCounts({ ...OK, types: 17 })).toThrow(/18/);
  });

  it('throws with an explicit row-count error when pokemons is wrong', () => {
    expect(() => assertSeedCounts({ ...OK, pokemons: 53 })).toThrow(/54/);
  });

  it('throws with an explicit row-count error when effectiveness is below 324', () => {
    expect(() => assertSeedCounts({ ...OK, effectiveness: 323 })).toThrow(/324/);
  });

  it('throws when a type is missing from the attacking side', () => {
    expect(() => assertSeedCounts({ ...OK, attackingTypes: 17 })).toThrow(/attacking/);
  });

  it('throws when a type is missing from the defending side', () => {
    expect(() => assertSeedCounts({ ...OK, defendingTypes: 18 - 1 })).toThrow(/defending/);
  });
});
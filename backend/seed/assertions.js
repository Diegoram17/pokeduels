/** Expected post-seed counts (from the db-schema-seed spec). */
export const EXPECTED_COUNTS = {
  types: 18,
  pokemons: 150,
  effectiveness: 324,
  attackingTypes: 18,
  defendingTypes: 18,
};

/**
 * Asserts the post-seed row counts and 18-type coverage on both sides of the
 * effectiveness matrix. Throws loudly on any mismatch — the seed never
 * completes silently with fewer rows than required.
 *
 * @param {{types: number, pokemons: number, effectiveness: number, attackingTypes: number, defendingTypes: number}} counts
 * @returns {true}
 */
export function assertSeedCounts(counts) {
  if (counts.types !== EXPECTED_COUNTS.types) {
    throw new Error(`Seed assertion failed: expected ${EXPECTED_COUNTS.types} types, found ${counts.types}`);
  }
  if (counts.pokemons !== EXPECTED_COUNTS.pokemons) {
    throw new Error(`Seed assertion failed: expected ${EXPECTED_COUNTS.pokemons} pokemons, found ${counts.pokemons}`);
  }
  if (counts.effectiveness !== EXPECTED_COUNTS.effectiveness) {
    throw new Error(
      `Seed assertion failed: expected ${EXPECTED_COUNTS.effectiveness} type_effectiveness rows, found ${counts.effectiveness}`,
    );
  }
  if (counts.attackingTypes !== EXPECTED_COUNTS.attackingTypes) {
    throw new Error(
      `Seed assertion failed: expected all ${EXPECTED_COUNTS.attackingTypes} types as attacking_type, found ${counts.attackingTypes}`,
    );
  }
  if (counts.defendingTypes !== EXPECTED_COUNTS.defendingTypes) {
    throw new Error(
      `Seed assertion failed: expected all ${EXPECTED_COUNTS.defendingTypes} types as defending_type, found ${counts.defendingTypes}`,
    );
  }
  return true;
}
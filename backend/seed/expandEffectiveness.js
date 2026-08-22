/**
 * Expands the sparse curated type-effectiveness rows into the full dense
 * matrix: one row per ordered (attacking_type, defending_type) pair.
 * Curated multipliers win; any uncurated pair defaults to neutral 1.0.
 *
 * @param {Array<{attacking_type: string, defending_type: string, multiplier: number}>} sparseRows
 * @param {string[]} types - ordered list of type names (the 18 canonical types)
 * @returns {Array<{attacking_type: string, defending_type: string, multiplier: number}>}
 */
export function expandEffectiveness(sparseRows, types) {
  const sparse = new Map(
    sparseRows.map((row) => [`${row.attacking_type}|${row.defending_type}`, row.multiplier]),
  );

  const rows = [];
  for (const attacking of types) {
    for (const defending of types) {
      rows.push({
        attacking_type: attacking,
        defending_type: defending,
        multiplier: sparse.get(`${attacking}|${defending}`) ?? 1.0,
      });
    }
  }
  return rows;
}
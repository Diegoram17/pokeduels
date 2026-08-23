/**
 * Type-effectiveness cache for the duel engine (Phase 1).
 *
 * The full 18x18 (324-row) `type_effectiveness` matrix is loaded once at
 * startup into an in-memory Map and reused for every damage calculation
 * (ADR-0001: single process, RNF-1 <500ms). Pure module: the pool is injected
 * by the caller, so unit tests never touch Postgres.
 *
 * Cache shape: Map<"attacking_type|defending_type", multiplier:number>
 */

const CACHE_KEY = (attackingType, defendingType) =>
  `${attackingType}|${defendingType}`;

let singletonCache = null;

/**
 * Factory for tests (and any consumer that needs a standalone cache).
 * Accepts optional rows in the same shape the DB query returns, normalizing
 * pg's NUMERIC strings ("2.0") to numbers.
 *
 * @param {Array<{attacking_type: string, defending_type: string, multiplier: string|number}>} [rows]
 * @returns {Map<string, number>}
 */
export function createCache(rows = []) {
  const cache = new Map();
  for (const row of rows) {
    cache.set(
      CACHE_KEY(row.attacking_type, row.defending_type),
      Number(row.multiplier),
    );
  }
  return cache;
}

/**
 * Loads the full type-effectiveness matrix into the module singleton and
 * returns it. Call once at startup with the app's pg pool.
 *
 * @param {{ query: (sql: string) => Promise<{rows: Array<object>}> }} pool
 * @returns {Promise<Map<string, number>>}
 */
export async function loadTypeEffectivenessCache(pool) {
  const { rows } = await pool.query(
    'SELECT attacking_type, defending_type, multiplier FROM type_effectiveness',
  );
  singletonCache = createCache(rows);
  return singletonCache;
}

/**
 * Returns the module singleton, throwing if it was never loaded.
 * @returns {Map<string, number>}
 */
export function getEffectivenessCache() {
  if (!singletonCache) {
    throw new Error(
      'Type-effectiveness cache not loaded: call loadTypeEffectivenessCache(pool) at startup',
    );
  }
  return singletonCache;
}

/**
 * Test/hot-reload escape hatch: clears the module singleton.
 */
export function resetEffectivenessCache() {
  singletonCache = null;
}

/**
 * Looks up the attacking-vs-defending multiplier (2.0 / 1.0 / 0.5).
 * Throws when the pair is absent (malformed seed data) — never guesses.
 *
 * @param {Map<string, number>} cache
 * @param {string} attackerType
 * @param {string} defenderType
 * @returns {number}
 */
export function getMultiplier(cache, attackerType, defenderType) {
  const multiplier = cache.get(CACHE_KEY(attackerType, defenderType));
  if (multiplier === undefined) {
    throw new Error(
      `No type-effectiveness multiplier defined for "${attackerType}" vs "${defenderType}"`,
    );
  }
  return multiplier;
}
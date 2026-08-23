/**
 * In-memory duel phase store (Phase 2).
 *
 * Holds the 5-phase FSM state (`Map<duelId, phase>`) for every live duel in
 * the shared process (ADR-0001 single-process model). The coarse `duels.status`
 * column in Postgres is deliberately left untouched — live phase is ephemeral
 * and dies with the process (restart reconciliation is item #8, out of scope).
 *
 * Exports a module-level singleton for the running app plus a `createPhaseStore()`
 * factory for test isolation.
 */

/**
 * Creates an isolated phase store over its own Map.
 * @returns {{
 *   get: (duelId: number) => string | undefined,
 *   set: (duelId: number, phase: string) => void,
 *   delete: (duelId: number) => void,
 *   clear: () => void,
 * }}
 */
export function createPhaseStore() {
  const phases = new Map();

  return {
    get(duelId) {
      return phases.get(duelId);
    },
    set(duelId, phase) {
      phases.set(duelId, phase);
    },
    delete(duelId) {
      phases.delete(duelId);
    },
    clear() {
      phases.clear();
    },
  };
}

let singletonPhaseStore = null;

/**
 * Returns the shared process-wide phase store, creating it on first use.
 * @returns {ReturnType<typeof createPhaseStore>}
 */
export function getPhaseStore() {
  if (!singletonPhaseStore) {
    singletonPhaseStore = createPhaseStore();
  }
  return singletonPhaseStore;
}

/**
 * Test escape hatch: drops the shared singleton. Factory-created stores are
 * unaffected (they own their own Map).
 */
export function resetPhaseStore() {
  singletonPhaseStore = null;
}
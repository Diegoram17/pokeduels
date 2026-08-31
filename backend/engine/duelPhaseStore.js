/**
 * In-memory duel phase store (Phase 2).
 *
 * Holds the 5-phase FSM state (`Map<duelId, phase>`) for every live duel in
 * the shared process (ADR-0001 single-process model). The coarse `duels.status`
 * column in Postgres is deliberately left untouched — live phase is ephemeral
 * and dies with the process (restart reconciliation is item #8, out of scope).
 *
 * A1-3b: factory-only. The module-level singleton trio
 * (`singletonPhaseStore` / `getPhaseStore()` / `resetPhaseStore()`) is
 * DELETED — the composition root (DuelContext) owns the store via
 * `createPhaseStore()` and injects it into every collaborator (spec A1: "No
 * registry-less singleton MAY be silently cached").
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

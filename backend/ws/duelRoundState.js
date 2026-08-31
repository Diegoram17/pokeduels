/**
 * WS-layer round sub-state store (item #5, design: "WS round sub-state
 * ownership"). Parallel to the coarse engine FSM (engine/stateMachine.js,
 * which MUST NOT be modified): per-duel fine-grained round sub-state
 * (`AWAITING_LEAD | AWAITING_SWITCH | AWAITING_ACTIONS | RESOLVING`) plus a
 * small lead-readiness map so the WS layer knows when BOTH players picked
 * their first lead (only then does the engine FSM advance
 * LEAD_SELECTION -> IN_PROGRESS).
 *
 * A1-3b: factory-only (same shape as engine/duelPhaseStore.js). The module
 * singleton trio (`singletonRoundStateStore` / `getRoundStateStore()` /
 * `resetRoundStateStore()`) is DELETED — the DuelContext composition root owns
 * the store via `createRoundStateStore()` and injects it into every
 * collaborator. Ephemeral: dies with the process (restart reconciliation is
 * #8, out of scope).
 */

export const ROUND_SUB_STATES = Object.freeze({
  AWAITING_LEAD: 'AWAITING_LEAD',
  AWAITING_SWITCH: 'AWAITING_SWITCH',
  AWAITING_ACTIONS: 'AWAITING_ACTIONS',
  RESOLVING: 'RESOLVING',
});

/**
 * Creates an isolated round sub-state store over its own Maps.
 * @returns {{
 *   get: (duelId: number) => string | undefined,
 *   set: (duelId: number, subState: string) => void,
 *   delete: (duelId: number) => void,
 *   clear: () => void,
 *   markLeadReady: (duelId: number, playerId: number) => void,
 *   bothLeadsReady: (duelId: number) => boolean,
 * }}
 */
export function createRoundStateStore() {
  const states = new Map();
  const leadReady = new Map();

  return {
    get(duelId) {
      return states.get(duelId);
    },
    set(duelId, subState) {
      states.set(duelId, subState);
    },
    delete(duelId) {
      states.delete(duelId);
      leadReady.delete(duelId);
    },
    clear() {
      states.clear();
      leadReady.clear();
    },
    markLeadReady(duelId, playerId) {
      let set = leadReady.get(duelId);
      if (!set) {
        set = new Set();
        leadReady.set(duelId, set);
      }
      set.add(playerId);
    },
    bothLeadsReady(duelId) {
      const set = leadReady.get(duelId);
      return set !== undefined && set.size >= 2;
    },
  };
}

/**
 * Per-duel fault isolation (Phase 3). Closes SECURITY-REPORT PL1-06 under
 * ADR-0001's single-process model: one duel's resolution crashing must never
 * take down the shared Node process or poison another duel's state.
 *
 * `withDuelFaultIsolation(duelId, fn)` wraps ONLY that duel's `resolverRonda`
 * call. A thrown error is caught, logged loudly WITH the duelId, and returned
 * as `{ ok: false, error }` — the caller decides what to do, the process keeps
 * running, and no other duel is touched.
 *
 * IMPORTANT — scope: GENUINE faults only. Insufficient-PP rejection is expected
 * user input, not a fault: `resolveRoundLogic` returns it as a normal
 * `{ type: 'rejected', reason: 'insufficient_pp' }` event and never throws, so
 * it is never routed through this wrapper. If it were, the engine would
 * misclassify a routine player action as a crash.
 *
 * @param {number|string} duelId - duel being resolved (for the log line)
 * @param {() => Promise<any>} fn - the per-duel work (resolverRonda call)
 * @returns {Promise<{ ok: true, result: any } | { ok: false, error: Error }>}
 */
export async function withDuelFaultIsolation(duelId, fn) {
  try {
    const result = await fn();
    return { ok: true, result };
  } catch (error) {
    console.error(`[duel-fault] duel ${duelId} failed: ${error.message}`, error);
    return { ok: false, error };
  }
}
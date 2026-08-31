import { finishDuelWrite } from '../repositories/duelRepository.js';

/**
 * Centralized duel-finish lifecycle (item #6, PR 2). Single termination path for
 * every duel-end trigger (KO, surrender, disconnect): persist exactly once via
 * `finishDuelWrite` (conditional `WHERE status='in_progress'`), and only when
 * the write actually applied, clean up per-duel timer/buffer/round sub-state
 * and broadcast `duel:finished`.
 *
 * Scope boundary (enforced by design): this module writes ONLY
 * `duels.status/winner_id/end_reason`; it NEVER touches `rooms.status` or
 * `room_players`, and NEVER emits any bracket-advance signal (owned by backlog
 * #7).
 *
 * A1-3b: factory-only shape with ALL dependencies injected. The module
 * singletons (`getTurnCycle` / `getTurnTimerRegistry` / `getRoundStateStore` /
 * `getPhaseStore` / `getDuelLifecycle`) and the module-level
 * `finalizeDuelSideEffects` / `finishDuel` shims are GONE — the composition
 * root builds the lifecycle over the context-owned collaborators (design:
 * `createDuelLifecycle({ turnTimers, turnCycle, duelRoundState, phaseStore })`).
 */

/**
 * Creates an isolated duel-lifecycle over injected dependencies. The
 * composition root (DuelContext) supplies every collaborator: the per-server
 * turn-timer registry, the shared turn cycle, the WS round sub-state store,
 * and the phase store (so `finalizeDuelSideEffects` can evict the duel's
 * phase entry — ADR-0005 terminal-state eviction).
 *
 * @param {{ turnTimers: object, turnCycle: object, duelRoundState: object,
 *           phaseStore: object }} deps
 * @returns {{ finishDuel: Function, finalizeDuelSideEffects: Function }}
 */
export function createDuelLifecycle({ turnTimers, turnCycle, duelRoundState, phaseStore }) {
  /**
   * Cleans up a finished duel's per-duel side effects and broadcasts the
   * outcome. Called only after the finish write applied (or by the KO path
   * after its own guarded transactional write). All cleanup is per-duel and
   * idempotent: cancels the 10s turn window, drops the buffered actions,
   * deletes the WS round sub-state, and evicts the duel phase-store entry
   * (ADR-0005 terminal-state eviction) — never the global `clear()` on any
   * store.
   *
   * @param {import('socket.io').Server} io
   * @param {number} duelId
   * @param {number} winnerId
   * @param {'ko'|'surrender'|'disconnect'|'walkover'} endReason
   */
  async function finalizeDuelSideEffects(io, duelId, winnerId, endReason) {
    turnTimers.cancel(duelId);
    turnCycle.dropBuffer(duelId);
    duelRoundState.delete(duelId);
    phaseStore.delete(duelId);
    io.to(`duel:${duelId}`).emit('duel:finished', { duelId, winnerId, endReason });
  }

  /**
   * Ends a duel through the centralized path. Persists `duels` exactly once;
   * on `{applied:true}` runs `finalizeDuelSideEffects`. When the write affects
   * 0 rows (already finished, or no such duel), returns `{applied:false}` and
   * touches no side effects or broadcasts — the atomic tie-break for
   * simultaneous finishes.
   *
   * @param {import('socket.io').Server} io
   * @param {number} duelId
   * @param {number} winnerId
   * @param {'ko'|'surrender'|'disconnect'|'walkover'} endReason
   * @returns {Promise<{ applied: boolean }>}
   */
  async function finishDuel(io, duelId, winnerId, endReason) {
    const { applied } = await finishDuelWrite(duelId, winnerId, endReason);
    if (applied) {
      await finalizeDuelSideEffects(io, duelId, winnerId, endReason);
    }
    return { applied };
  }

  return { finishDuel, finalizeDuelSideEffects };
}
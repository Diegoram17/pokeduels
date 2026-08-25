import { finishDuelWrite } from '../repositories/duelRepository.js';
import { getTurnCycle } from './turnCycle.js';
import { getRoundStateStore } from './duelRoundState.js';
import { getTurnTimerRegistry } from './turnTimers.js';
import { getPhaseStore } from '../engine/duelPhaseStore.js';

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
 */

/**
 * Creates an isolated duel-lifecycle over injected dependencies. The default
 * (module-level) instance uses the shared singletons; handlers that own a
 * per-server `turnTimers` registry (composition root) pass it here so the
 * correct timer is cancelled.
 *
 * @param {{ turnTimers?: object, turnCycle?: object, duelRoundState?: object }} [deps]
 * @returns {{ finishDuel: Function, finalizeDuelSideEffects: Function }}
 */
export function createDuelLifecycle({
  turnTimers = getTurnTimerRegistry(),
  turnCycle = getTurnCycle(),
  duelRoundState = getRoundStateStore(),
} = {}) {
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
    getPhaseStore().delete(duelId);
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

let singletonLifecycle = null;

/**
 * Returns the shared process-wide duel lifecycle bound to the default
 * singletons (`getTurnTimerRegistry()`, `getTurnCycle()`,
 * `getRoundStateStore()`).
 * @returns {{ finishDuel: Function, finalizeDuelSideEffects: Function }}
 */
export function getDuelLifecycle() {
  if (!singletonLifecycle) {
    singletonLifecycle = createDuelLifecycle();
  }
  return singletonLifecycle;
}

/**
 * Default singleton accessors (design interface contract). Prefer
 * `createDuelLifecycle({ turnTimers })` when a per-server timer registry must
 * be cancelled.
 */
export const finalizeDuelSideEffects = (...args) =>
  getDuelLifecycle().finalizeDuelSideEffects(...args);
export const finishDuel = (...args) => getDuelLifecycle().finishDuel(...args);

/**
 * Test escape hatch: drops the shared lifecycle singleton. Factory-created
 * lifecycles are unaffected.
 */
export function resetDuelLifecycle() {
  singletonLifecycle = null;
}

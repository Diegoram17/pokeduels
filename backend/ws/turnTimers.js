/**
 * In-memory registry of per-duel 10s turn timers (item #5, design: the
 * "value-producing" timer). Same factory + `Map<key, Timeout>` pattern as
 * reconnectTimers.js, collapsed to a SINGLE-ARG key: `duelId` alone is already
 * unique per duel, so the composite `${roomId}:${playerId}` key adds nothing.
 *
 * The expiry callback runs outside the Socket.IO event loop (setTimeout), so
 * any sync throw or async rejection is caught and logged here — a failing
 * callback must never take down the shared process (ADR-0001, mirrors
 * reconnectTimers.js's error containment). The "value" the turn needs is
 * produced by the SHARED action buffer (turnCycle.js), not by this timer: the
 * timer stays a plain side-effecting callback that fills the missing player's
 * timeout action and triggers resolution.
 *
 * Known limitation per spec: timers are NOT persisted; a backend restart loses
 * in-flight turn windows (accepted, documented).
 */
export const DEFAULT_TURN_TIMEOUT_MS = 10_000;

export function createTurnTimerRegistry({ timeoutMs = DEFAULT_TURN_TIMEOUT_MS } = {}) {
  const timers = new Map();

  return {
    /**
     * Starts (or restarts, replacing any pending timer for the same duel) the
     * 10s turn window. onExpire is invoked once after timeoutMs unless
     * cancelled.
     */
    start(duelId, onExpire) {
      const existing = timers.get(duelId);
      if (existing) clearTimeout(existing);

      timers.set(
        duelId,
        setTimeout(() => {
          timers.delete(duelId);
          Promise.resolve()
            .then(onExpire)
            .catch((err) => {
              console.error(`[turn-timer] expire callback failed: ${err.message}`, err);
            });
        }, timeoutMs),
      );
    },

    /** Cancels the pending window; returns true only if one existed. */
    cancel(duelId) {
      const existing = timers.get(duelId);
      if (!existing) return false;
      clearTimeout(existing);
      timers.delete(duelId);
      return true;
    },

    /** True while a turn window is pending for the duel. */
    has(duelId) {
      return timers.has(duelId);
    },

    /** Cancels every pending window (test teardown / server shutdown). */
    clear() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
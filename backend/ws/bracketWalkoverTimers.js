/**
 * In-memory registry of between-round bracket-walkover timers for the WS lobby
 * (item #7, PR 3, design decision 6). A 4-player bracket player who silently
 * disconnects while awaiting a pending duel (their next bracket round) gets a
 * grace window; if it expires without a reconnect, the walkover callback
 * records a timeout default-loss for that pending duel. An explicit room:leave
 * between rounds bypasses the timer entirely (immediate walkover).
 *
 * Mirror of reconnectTimers.js (same Map<'roomId:playerId', Timeout> factory
 * shape). It imports DEFAULT_RECONNECT_GRACE_MS for value parity (60s — the
 * same grace the mid-duel disconnect uses), but is a SEPARATE instance created
 * in ws/index.js's composition root and injected into registerRoomHandlers.
 * The expire callback runs outside the Socket.IO event loop (setTimeout), so
 * any sync throw or async rejection is caught and logged here — a failing
 * callback must never take down the shared process (ADR-0001).
 */
import { DEFAULT_RECONNECT_GRACE_MS } from './reconnectTimers.js';

export const DEFAULT_BRACKET_WALKOVER_GRACE_MS = DEFAULT_RECONNECT_GRACE_MS;

export function createBracketWalkoverTimerRegistry({
  graceMs = DEFAULT_BRACKET_WALKOVER_GRACE_MS,
} = {}) {
  const timers = new Map();

  const key = (roomId, playerId) => `${roomId}:${playerId}`;

  return {
    /**
     * Arms (or re-arms, replacing any pending timer for the same pair) the
     * walkover window. onExpire is invoked once after graceMs unless cancelled
     * (a room:join reconnect within the window cancels it).
     */
    arm(roomId, playerId, onExpire) {
      const k = key(roomId, playerId);
      const existing = timers.get(k);
      if (existing) clearTimeout(existing);

      timers.set(
        k,
        setTimeout(() => {
          timers.delete(k);
          Promise.resolve()
            .then(onExpire)
            .catch((err) => {
              console.error(`[bracket-walkover] expire callback failed: ${err.message}`, err);
            });
        }, graceMs),
      );
    },

    /** Cancels the pending window; returns true only if one existed. */
    cancel(roomId, playerId) {
      const k = key(roomId, playerId);
      const existing = timers.get(k);
      if (!existing) return false;
      clearTimeout(existing);
      timers.delete(k);
      return true;
    },

    /** True while a walkover window is pending for the pair. */
    has(roomId, playerId) {
      return timers.has(key(roomId, playerId));
    },

    /** Cancels every pending window (test teardown / server shutdown). */
    clear() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

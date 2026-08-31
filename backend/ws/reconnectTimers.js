import { logger } from '../lib/logger.js';

/**
 * In-memory registry of reconnect grace timers for the WS lobby (design:
 * "Reconnect timer storage — in-memory Map<roomId:playerId, Timeout> via a
 * factory"). Known limitation per spec: timers are NOT persisted; a backend
 * restart loses in-flight grace windows (accepted, documented).
 *
 * The expire callback runs outside the Socket.IO event loop (setTimeout), so
 * any sync throw or async rejection is caught and logged here — a failing
 * callback must never take down the shared process (ADR-0001, mirrors
 * engine/faultIsolation.js).
 */
export const DEFAULT_RECONNECT_GRACE_MS = 60_000;

export function createReconnectTimerRegistry({ graceMs = DEFAULT_RECONNECT_GRACE_MS } = {}) {
  const timers = new Map();

  const key = (roomId, playerId) => `${roomId}:${playerId}`;

  return {
    /**
     * Starts (or restarts, replacing any pending timer for the same pair) the
     * grace window. onExpire is invoked once after graceMs unless cancelled.
     */
    start(roomId, playerId, onExpire) {
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
              logger.error({ err, roomId, playerId }, 'reconnect-timer expire callback failed');
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

    /** True while a grace window is pending for the pair. */
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
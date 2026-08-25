/**
 * F2 — per-socket WebSocket event rate limiter (design: "fixed-window
 * in-memory counter per socket.id, attached via socket.onAny(); breach →
 * socket.disconnect(true)").
 *
 * Socket.IO v4 calls every onAny listener with the socket as `this` and the
 * event name + payload as arguments: `listener.apply(socket, [event, ...args])`.
 * The factory therefore returns a plain function that reads `socket` from its
 * `this` binding, so attaching is a single choke point covering every event
 * regardless of which handler processes it.
 *
 * The fixed window uses wall-clock time (Date.now()). On breach the socket is
 * disconnected hard (disconnect(true)) and no further events are processed,
 * per the locked product decision (disconnect, not drop-only).
 *
 * @param {{ windowMs: number, limit: number }} config
 * @returns {(event: string, ...args: unknown[]) => void} middleware handler
 */
export function createWsRateLimiter({ windowMs, limit }) {
  // socket.id -> { count, windowStart } fixed-window counter.
  const counters = new Map();

  return function wsRateLimitHandler(_event, ..._args) {
    const socket = this; // socket.io binds the socket as `this` for onAny
    const now = Date.now();

    let entry = counters.get(socket.id);
    if (!entry || now - entry.windowStart >= windowMs) {
      // Fresh window for this socket (first event or the previous one expired).
      counters.set(socket.id, { count: 1, windowStart: now });
      // Remove the counter once this socket disconnects so the map does not
      // grow unboundedly with short-lived sockets.
      socket.once('disconnect', () => {
        counters.delete(socket.id);
      });
      return;
    }

    entry.count += 1;
    if (entry.count > limit) {
      socket.disconnect(true);
    }
  };
}

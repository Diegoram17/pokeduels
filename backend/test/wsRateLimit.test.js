import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWsRateLimiter } from '../middleware/wsRateLimit.js';

/**
 * Unit tests for the F2 per-socket WS rate limiter (design: "fixed-window
 * in-memory counter per socket.id, attached via socket.onAny(); breach →
 * socket.disconnect(true)").
 *
 * Socket.IO v4 calls every onAny listener with the socket as `this` and the
 * event name + payload as arguments: `listener.apply(socket, [event, ...args])`.
 * The factory therefore returns a plain function that reads `socket` from its
 * `this` binding — matching the real API contract, so these tests drive the
 * middleware exactly as Socket.IO does.
 */

/** Builds a minimal fake socket exposing only what the limiter touches. */
function makeSocket(id) {
  return {
    id,
    disconnected: false,
    disconnectCalls: [],
    disconnect(close) {
      this.disconnected = true;
      this.disconnectCalls.push(close);
    },
  };
}

/** Invokes a wsRateLimit handler the way Socket.IO's onAny dispatch does. */
function dispatch(handler, socket, event, ...args) {
  handler.apply(socket, [event, ...args]);
}

describe('createWsRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a function (the middleware handler)', () => {
    const handler = createWsRateLimiter({ windowMs: 10000, limit: 40 });
    expect(typeof handler).toBe('function');
  });

  it('lets events within the limit pass through without disconnecting', () => {
    const handler = createWsRateLimiter({ windowMs: 10000, limit: 3 });
    const socket = makeSocket('s-1');

    dispatch(handler, socket, 'room:join', { code: 'ABC' });
    dispatch(handler, socket, 'duel:start');
    dispatch(handler, socket, 'duel:select_lead', { pokemonId: 101 });

    expect(socket.disconnected).toBe(false);
  });

  it('disconnects the socket once the limit is exceeded', () => {
    const handler = createWsRateLimiter({ windowMs: 10000, limit: 3 });
    const socket = makeSocket('s-2');

    dispatch(handler, socket, 'a', 1);
    dispatch(handler, socket, 'b', 2);
    dispatch(handler, socket, 'c', 3);
    // limit = 3 events allowed; the 4th breaches it
    dispatch(handler, socket, 'd', 4);

    expect(socket.disconnected).toBe(true);
  });

  it('disconnects with a hard close (disconnect(true))', () => {
    const handler = createWsRateLimiter({ windowMs: 10000, limit: 0 });
    const socket = makeSocket('s-3');

    dispatch(handler, socket, 'x', 1);

    expect(socket.disconnected).toBe(true);
    expect(socket.disconnectCalls).toEqual([true]);
  });

  it('resets the window after windowMs elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const handler = createWsRateLimiter({ windowMs: 10000, limit: 3 });
    const socket = makeSocket('s-4');

    dispatch(handler, socket, 'a', 1);
    dispatch(handler, socket, 'b', 2);
    dispatch(handler, socket, 'c', 3);
    dispatch(handler, socket, 'd', 4); // breach
    expect(socket.disconnected).toBe(true);

    // After the window, a fresh burst is allowed again.
    vi.setSystemTime(1_000_000 + 10001);
    dispatch(handler, socket, 'e', 5);
    dispatch(handler, socket, 'f', 6);
    dispatch(handler, socket, 'g', 7);
    dispatch(handler, socket, 'h', 8); // breach again
    expect(socket.disconnected).toBe(true);
  });

  it('keeps counters independent per socket.id', () => {
    const handler = createWsRateLimiter({ windowMs: 10000, limit: 2 });
    const socketA = makeSocket('s-A');
    const socketB = makeSocket('s-B');

    dispatch(handler, socketA, 'a', 1);
    dispatch(handler, socketA, 'b', 2);
    dispatch(handler, socketA, 'c', 3); // A breaches
    expect(socketA.disconnected).toBe(true);

    // B's counter is untouched — a single event stays under its limit.
    dispatch(handler, socketB, 'x', 1);
    expect(socketB.disconnected).toBe(false);
  });
});

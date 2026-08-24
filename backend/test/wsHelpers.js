import { createServer } from 'node:http';
import { io as ioClient } from 'socket.io-client';
import { createApp } from '../app.js';
import { createSocketServer } from '../ws/index.js';
import { pool } from '../db/pool.js';
import { loadTypeEffectivenessCache } from '../engine/typeEffectiveness.js';

/**
 * WS integration-test harness (design: "backend/test/wsHelpers.js — ephemeral
 * http.createServer(createApp()) + createSocketServer(httpServer, {
 * reconnectGraceMs: 200 }), httpServer.listen(0)"). One ephemeral listener
 * serves both the Express app and the Socket.IO layer, exactly like
 * server.js does in production; the short injected reconnect grace window
 * lets reconnect tests run on real wall-clock time (no fake timers, per the
 * design's testing strategy).
 */

export const DEFAULT_RECONNECT_GRACE_MS = 200;
// Neon serverless latency: each DB round trip on a sleeping instance can take
// ~1.5s (observed), and one room:join handler runs ~6 queries (~9s worst case).
// A short event timeout makes tests fail while the handler is still working —
// and worse, the afterAll pool.end() then breaks the still-running handler.
// Keep the default generous; vitest's testTimeout (30s) is the real ceiling.
export const DEFAULT_EVENT_TIMEOUT_MS = 15000;

/**
 * Resolves with the next emission of `event` on `emitter`, or rejects after
 * timeoutMs. Single-argument emissions resolve to that argument; multi-arg
 * emissions resolve to the full args array (e.g. 'connect_error' handlers).
 */
export function waitForEvent(emitter, event, timeoutMs = DEFAULT_EVENT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for "${event}" after ${timeoutMs}ms`)),
      timeoutMs,
    );
    emitter.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args.length > 1 ? args : args[0]);
    });
  });
}

/**
 * Polls `predicate` every `intervalMs` until it returns truthy or timeoutMs
 * elapses. Accepts sync or async predicates. Sequences tests around
 * server-side effects that have no event to await — e.g. waiting until the
 * reconnect grace timer is armed after a socket disconnect (so a resume join
 * is guaranteed to cancel an existing timer), or polling the DB until a slow
 * transaction's effect is visible.
 */
export async function waitUntil(predicate, timeoutMs = 5000, intervalMs = 10) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Starts an ephemeral WS harness on an OS-assigned port. Returns
 * `{ httpServer, io, reconnectTimers, port, url, connect, teardown }`:
 * - connect(sessionToken) — opens a socket.io-client connection authenticated
 *   with the player's session token (reconnection disabled; tests drive
 *   reconnects explicitly).
 * - teardown() — closes every client socket, clears pending grace timers,
 *   then closes the Socket.IO server and the http server.
 */
export async function startWsHarness({
  reconnectGraceMs = DEFAULT_RECONNECT_GRACE_MS,
  turnTimeoutMs,
  corsOrigin,
} = {}) {
  // Mirror server.js boot: the duel engine's type-effectiveness cache must be
  // loaded before any round can resolve (resolverRonda faults otherwise). The
  // singleton is reloaded per harness so a prior file's resetEffectivenessCache
  // teardown never starves this one.
  await loadTypeEffectivenessCache(pool);
  const httpServer = createServer(createApp());
  const { io, reconnectTimers, turnTimers } = createSocketServer(httpServer, {
    reconnectGraceMs,
    ...(turnTimeoutMs !== undefined ? { turnTimeoutMs } : {}),
    ...(corsOrigin !== undefined ? { corsOrigin } : {}),
  });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  const url = `http://127.0.0.1:${port}`;

  const clients = new Set();

  async function connect(sessionToken) {
    const client = ioClient(url, { reconnection: false, auth: { sessionToken } });
    clients.add(client);
    await waitForEvent(client, 'connect');
    return client;
  }

  async function teardown() {
    for (const client of clients) client.close();
    clients.clear();
    // Closing seated clients arms server-side reconnect grace timers (the
    // disconnect handler runs markPlayerDisconnected, then timer.start). Let
    // those fire (and their leaveRoom run) while the pool is still alive, then
    // clear whatever remains — otherwise a timer can expire after afterAll's
    // pool.end() and log a misleading "pool already ended" error. The settle
    // is capped: disconnect handlers that complete later than this simply
    // produce the same caught, cosmetic log line.
    await new Promise((resolve) => setTimeout(resolve, Math.min(DEFAULT_RECONNECT_GRACE_MS, 500) + 150));
    reconnectTimers.clear();
    turnTimers.clear();
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  }

  return { httpServer, io, reconnectTimers, turnTimers, port, url, connect, teardown };
}

/**
 * Connects a player and joins them into `code` over the WS, returning the
 * connected client and the room:state broadcast confirming the seat. Used
 * for both fresh joins and reconnects (resume path) — the server decides.
 */
export async function joinRoomViaWs(harness, player, code) {
  const client = await harness.connect(player.sessionToken);
  const stateP = waitForEvent(client, 'room:state');
  client.emit('room:join', { code, nickname: player.nickname });
  const state = await stateP;
  return { client, state };
}
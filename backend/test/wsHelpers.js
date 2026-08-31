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
 * `{ httpServer, io, reconnectTimers, turnTimers, ctx, port, url, connect,
 * teardown }`:
 * - ctx — the DuelContext composition root (spec A1), so suites can reach the
 *   phase/round stores, turn cycle and lifecycle the handlers use.
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
  const { io, reconnectTimers, turnTimers, ctx } = createSocketServer(httpServer, {
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

  return { httpServer, io, reconnectTimers, turnTimers, ctx, port, url, connect, teardown };
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

/**
 * Marks every client ready over WS (`room:ready`), one client at a time, and
 * drains the whole-room `room:state` broadcast after each emit — one event per
 * seated client in client order (the exact drain sequence the 1v1 suites
 * relied on). When `expectStart` is true (default), also collects every
 * `duel:start` payload broadcast to the FIRST client and resolves once
 * `expectedStarts` of them arrived (1 for a 1v1 room, 2 for a 4-player
 * bracket). Resolves with the collected `duel:start` payloads ([] when
 * expectStart is false).
 *
 * @param {import('socket.io-client').Socket[]} clients
 * @param {{ expectStart?: boolean, expectedStarts?: number }} [options]
 * @returns {Promise<object[]>}
 */
export async function readyAll(clients, { expectStart = true, expectedStarts = 1 } = {}) {
  const starts = [];
  let resolveStarts = () => {};
  const startsP = expectStart
    ? new Promise((resolve) => {
        resolveStarts = resolve;
      })
    : Promise.resolve();
  if (expectStart) {
    clients[0].on('duel:start', (payload) => {
      starts.push(payload);
      if (starts.length >= expectedStarts) resolveStarts();
    });
  }
  try {
    for (const client of clients) {
      client.emit('room:ready', { ready: true });
      // One room:state per seated client (the emitter's own copy first, then
      // every other client's copy — the same order the 1v1 readyBoth drained).
      for (const other of clients) {
        await waitForEvent(other, 'room:state');
      }
    }
    if (expectStart) await startsP;
  } finally {
    if (expectStart) clients[0].off('duel:start');
  }
  return starts;
}

/**
 * Subscribes one socket to the `duel:{duelId}` channel via `duel:join` and
 * resolves with the `duel:state` snapshot it receives. The server rejects the
 * join for a non-participant, so this also doubles as a participant check.
 *
 * @param {import('socket.io-client').Socket} client
 * @param {number} duelId
 * @returns {Promise<object>} the camelCase duel snapshot
 */
export async function joinDuelChannel(client, duelId) {
  const stateP = waitForEvent(client, 'duel:state');
  client.emit('duel:join', { duelId });
  return await stateP;
}

/**
 * Picks the first lead for every client (one pokemonId per client, in the same
 * order), then waits until both leads are active in the DB and the duel is
 * LIVE. The live check targets `phaseStore.get(duelId) === 'in_progress'`
 * when a phaseStore is given (the duelHandlers suite's wait), else the coarse
 * `duels.status` column (the duelDisconnect suite's wait) — both transition in
 * the same handler completion, so either wait leaves the duel ready for
 * actions. Both semifinals of a 4-player bracket can be driven with separate
 * calls: every wait is per-duel.
 *
 * @param {import('socket.io-client').Socket[]} clients
 * @param {number} duelId
 * @param {number[]} pokemonIds - one lead per client, in client order
 * @param {object} [phaseStore] - when given, the live wait targets it
 */
export async function selectLeads(clients, duelId, pokemonIds, phaseStore) {
  for (let i = 0; i < clients.length; i += 1) {
    clients[i].emit('duel:select_lead', { duelId, pokemonId: pokemonIds[i] });
  }
  await waitUntil(
    () =>
      pool.query(
        `SELECT COUNT(*)::int AS n FROM duel_pokemon_state
         WHERE duel_id = $1 AND is_active = TRUE`,
        [duelId],
      ).then((r) => r.rows[0].n === 2),
    20000,
  );
  if (phaseStore) {
    await waitUntil(() => phaseStore.get(duelId) === 'in_progress', 20000);
  } else {
    await waitUntil(
      () =>
        pool.query('SELECT status FROM duels WHERE id = $1', [duelId])
          .then((r) => r.rows[0].status === 'in_progress'),
      20000,
    );
  }
}

/**
 * Plays one full round: every client emits `duel:select_action` with
 * `moveIndex` (default 4 — the always-eligible, no-PP-cost move), resolving
 * with the `duel:turn_resolved` payload on the first client.
 *
 * @param {import('socket.io-client').Socket[]} clients
 * @param {number} duelId
 * @param {number} [moveIndex=4]
 * @returns {Promise<object>} the `duel:turn_resolved` payload
 */
export async function playRoundToResolve(clients, duelId, moveIndex = 4) {
  const resolvedP = waitForEvent(clients[0], 'duel:turn_resolved', 45000);
  for (const client of clients) {
    client.emit('duel:select_action', { duelId, moveIndex });
  }
  return await resolvedP;
}

/**
 * Plays a duel to KO by stacking one side's team at the brink and looping
 * rounds (move 4 — 10 base dmg, no PP cost) until `duel:finished` arrives.
 * Mirrors the 1v1 KO test's DB stack: the `hpStack` side's whole team is
 * fainted except its active lead at 1 HP, so ANY hit (min 5 dmg) knocks it out
 * and wipes the team — the stacked side loses, the other client wins. The
 * `duel:finished` listener is registered before the first round and short-
 * circuits the race once the finish broadcast lands (after the KO round the
 * server emits turn_resolved then finished, in that order).
 *
 * @param {import('socket.io-client').Socket[]} clients - the duel's two sockets
 * @param {number} duelId
 * @param {{ playerId: number, leadPokemonId: number }} hpStack - the side
 *        stacked at the brink (their opponent wins)
 * @returns {Promise<object>} the `duel:finished` payload
 */
export async function playDuelToKO(clients, duelId, { hpStack }) {
  await pool.query(
    `UPDATE duel_pokemon_state SET fainted = TRUE, current_hp = 0, is_active = FALSE
     WHERE duel_id = $1 AND player_id = $2`,
    [duelId, hpStack.playerId],
  );
  await pool.query(
    `UPDATE duel_pokemon_state SET fainted = FALSE, current_hp = 1, is_active = TRUE
     WHERE duel_id = $1 AND player_id = $2 AND pokemon_id = $3`,
    [duelId, hpStack.playerId, hpStack.leadPokemonId],
  );

  let finishedPayload;
  const finishedP = waitForEvent(clients[0], 'duel:finished', 45000).then((p) => {
    finishedPayload = p;
    return 'finished';
  });
  for (;;) {
    const kind = await Promise.race([
      finishedP,
      playRoundToResolve(clients, duelId, 4).then(() => 'resolved'),
    ]);
    if (kind === 'finished') return finishedPayload;
  }
}
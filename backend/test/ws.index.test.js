import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { createSocketServer } from '../ws/index.js';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';

// Composition-root tests for createSocketServer: it must attach a real
// Socket.IO Server to the shared http.Server, expose { io, reconnectTimers },
// thread reconnectGraceMs into the timer registry, and gate every connection
// behind the touchSession auth middleware. The auth cases run a real
// handshake over a real ephemeral listener (no wsHelpers yet — that is PR 3).
function waitForEvent(emitter, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    emitter.once(event, (arg) => {
      clearTimeout(timer);
      resolve(arg);
    });
  });
}

async function startHarness(options) {
  const httpServer = createServer();
  const { io, reconnectTimers, turnTimers, bracketWalkoverTimers, ctx } =
    createSocketServer(httpServer, options);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  return {
    httpServer,
    io,
    reconnectTimers,
    turnTimers,
    bracketWalkoverTimers,
    ctx,
    port: httpServer.address().port,
  };
}

const harnesses = [];
afterEach(async () => {
  while (harnesses.length) {
    const { io, httpServer } = harnesses.pop();
    await new Promise((r) => io.close(r));
    await new Promise((r) => httpServer.close(r));
  }
});

describe('createSocketServer', () => {
  it('returns a Socket.IO Server and reconnect + turn timer registries', async () => {
    const { httpServer, io, reconnectTimers, turnTimers, ctx } = await startHarness();
    harnesses.push({ io, httpServer });

    expect(io).toBeInstanceOf(Server);
    expect(typeof reconnectTimers.start).toBe('function');
    expect(typeof reconnectTimers.cancel).toBe('function');
    expect(typeof reconnectTimers.has).toBe('function');
    expect(typeof reconnectTimers.clear).toBe('function');
    expect(typeof turnTimers.start).toBe('function');
    expect(typeof turnTimers.cancel).toBe('function');
    expect(typeof turnTimers.has).toBe('function');
    expect(typeof turnTimers.clear).toBe('function');
  });

  it('returns the DuelContext (spec A1) whose registries are the exposed ones', async () => {
    const { httpServer, io, reconnectTimers, turnTimers, bracketWalkoverTimers, ctx } =
      await startHarness();
    harnesses.push({ io, httpServer });

    // The ctx is the single composition root built before handler registration.
    // The registries the server exposes (and server.js hands to shutdown) MUST
    // be the exact instances the handlers use through ctx.
    expect(ctx.turnTimers).toBe(turnTimers);
    expect(ctx.reconnectTimers).toBe(reconnectTimers);
    expect(ctx.bracketWalkoverTimers).toBe(bracketWalkoverTimers);

    // Every collaborator is a working instance, not a stub.
    expect(ctx.turnCycle.bufferAction(1, 1, { moveIndex: 4 })).toEqual({
      isFirst: true,
      pairComplete: false,
    });
    ctx.phaseStore.set(99, 'pending');
    expect(ctx.phaseStore.get(99)).toBe('pending');
    ctx.phaseStore.delete(99);
    ctx.roundState.set(99, 'AWAITING_LEAD');
    expect(ctx.roundState.get(99)).toBe('AWAITING_LEAD');
    ctx.roundState.delete(99);
    expect(typeof ctx.lifecycle.finishDuel).toBe('function');
  });

  it('threads reconnectGraceMs into the timer registry', async () => {
    const { httpServer, io, reconnectTimers } = await startHarness({ reconnectGraceMs: 30 });
    harnesses.push({ io, httpServer });

    const onExpire = vi.fn();
    reconnectTimers.start('room-1', 'player-1', onExpire);
    await new Promise((r) => setTimeout(r, 90));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('threads turnTimeoutMs into the turn timer registry (item #5)', async () => {
    const { httpServer, io, turnTimers } = await startHarness({ turnTimeoutMs: 30 });
    harnesses.push({ io, httpServer });

    const onExpire = vi.fn();
    turnTimers.start(7, onExpire);
    await new Promise((r) => setTimeout(r, 90));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

describe.skipIf(!hasDatabase)('auth middleware (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    // touchSession validates tokens against the players table, so the schema
    // must be present. integration.test.js ends with `migrate down 0` which
    // empties the DB, so self-provision here (matching every other DB test
    // file) instead of assuming a prior file left the schema in place.
    await ensureSchemaAndSeed(pool);
    // Warm the connection: the first pool.query of a fresh worker pays a
    // cold-start that can take seconds, blowing the connect_error timeout
    // below. (Observed: touchSession(undefined) hung ~3s+ on first query.)
    await pool.query('SELECT 1');
  }, SEED_TIMEOUT);

  it('rejects a connection with no session token', async () => {
    const { httpServer, io, port } = await startHarness();
    harnesses.push({ io, httpServer });

    const client = ioClient(`http://127.0.0.1:${port}`, { reconnection: false });
    const err = await waitForEvent(client, 'connect_error');
    expect(err.message).toBe('unauthorized');
    client.close();
  });

  it('rejects an unknown session token', async () => {
    const { httpServer, io, port } = await startHarness();
    harnesses.push({ io, httpServer });

    const client = ioClient(`http://127.0.0.1:${port}`, {
      reconnection: false,
      auth: { sessionToken: '00000000-0000-4000-8000-000000000000' },
    });
    const err = await waitForEvent(client, 'connect_error');
    expect(err.message).toBe('unauthorized');
    client.close();
  });

  it('disconnects a socket that exceeds the per-event rate limit (F2 wiring)', async () => {
    const { httpServer, io, port } = await startHarness();
    harnesses.push({ io, httpServer });

    const player = await createPlayer('WSLimiterP1');
    const client = ioClient(`http://127.0.0.1:${port}`, {
      reconnection: false,
      auth: { sessionToken: player.sessionToken },
    });
    await waitForEvent(client, 'connect');

    // Production threshold is 40 events / 10s. Emit beyond it in a tight loop;
    // the limiter (attached in io.on('connection') before handlers) must hard
    // disconnect the socket.
    const disconnectP = waitForEvent(client, 'disconnect');
    for (let i = 0; i < 41; i++) {
      client.emit('duel:nonexistent', { n: i });
    }
    await disconnectP;
    expect(client.connected).toBe(false);
    client.close();
  });
});
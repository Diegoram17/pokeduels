import { Server } from 'socket.io';
import { touchSession } from '../db/players.js';
import { DEFAULT_TURN_TIMEOUT_MS } from './turnTimers.js';
import { createBracketWalkoverTimerRegistry } from './bracketWalkoverTimers.js';
import { createDuelContext } from './duelContext.js';
import { registerRoomHandlers } from './roomHandlers.js';
import { registerTeamHandlers } from './teamHandlers.js';
import { registerDuelHandlers } from './duelHandlers.js';
import { createWsRateLimiter } from '../middleware/wsRateLimit.js';

/**
 * Composition root for the WS lobby layer (design decision: "http.Server
 * exposure — server.js builds createServer(createApp()), passes the
 * http.Server to createSocketServer()"). Attaches a Socket.IO Server to the
 * shared HTTP listener, authenticates every connection via touchSession, and
 * wires the room + team + duel handlers.
 *
 * @param {import('node:http').Server} httpServer - shared listener
 * @param {{ reconnectGraceMs?: number, turnTimeoutMs?: number, corsOrigin?: string }} [options]
 * @returns {{ io: Server, reconnectTimers: object, turnTimers: object,
 *             bracketWalkoverTimers: object, ctx: object }} — all exposed for
 *   test teardown/assertions (design interface contract); `ctx` is the
 *   DuelContext composition root (spec A1)
 */
export function createSocketServer(
  httpServer,
  { reconnectGraceMs, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS, corsOrigin = '*' } = {},
) {
  const io = new Server(httpServer, { cors: { origin: corsOrigin } });
  const bracketWalkoverTimers = createBracketWalkoverTimerRegistry();
  // One DuelContext per server, built BEFORE any handler registers (spec A1 —
  // the ordering hazard is enforced by construction, not by comment). Slice 3a:
  // the context delegates to the module singletons and owns the fresh
  // per-server timer registries; the KO path's advanceTournamentOrRematch
  // still receives the walkover registry through it.
  const ctx = createDuelContext({ turnTimeoutMs, reconnectGraceMs, bracketWalkoverTimers });
  const { reconnectTimers } = ctx;

  // Auth: one touchSession() per connection (not per event). The resolved
  // player becomes socket.data.player; unknown tokens and DB faults reject
  // the handshake with a connect_error instead of ever opening the socket.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.sessionToken;
      const player = await touchSession(token);
      if (!player) return next(new Error('unauthorized'));
      socket.data.player = { id: player.id, nickname: player.nickname };
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    // F2 per-socket rate limit: attach BEFORE any handler so every inbound
    // event passes through the limiter regardless of which handler processes
    // it. Breach → hard disconnect (socket.disconnect(true)), per the locked
    // product decision (disconnect, not drop-only).
    socket.onAny(createWsRateLimiter({ windowMs: 10000, limit: 40 }));

    registerRoomHandlers(io, socket, ctx, reconnectTimers);
    registerTeamHandlers(io, socket);
    registerDuelHandlers(io, socket, ctx);
  });

  return { io, reconnectTimers, turnTimers: ctx.turnTimers, bracketWalkoverTimers, ctx };
}
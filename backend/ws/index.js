import { Server } from 'socket.io';
import { touchSession } from '../db/players.js';
import { createReconnectTimerRegistry } from './reconnectTimers.js';
import { registerRoomHandlers } from './roomHandlers.js';
import { registerTeamHandlers } from './teamHandlers.js';

/**
 * Composition root for the WS lobby layer (design decision: "http.Server
 * exposure — server.js builds createServer(createApp()), passes the
 * http.Server to createSocketServer()"). Attaches a Socket.IO Server to the
 * shared HTTP listener, authenticates every connection via touchSession, and
 * wires the room + team handlers.
 *
 * @param {import('node:http').Server} httpServer - shared listener
 * @param {{ reconnectGraceMs?: number, corsOrigin?: string }} [options]
 * @returns {{ io: Server, reconnectTimers: object }} — both exposed for test
 *   teardown/assertions (design interface contract)
 */
export function createSocketServer(httpServer, { reconnectGraceMs, corsOrigin = '*' } = {}) {
  const io = new Server(httpServer, { cors: { origin: corsOrigin } });
  const reconnectTimers = createReconnectTimerRegistry({ graceMs: reconnectGraceMs });

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
    registerRoomHandlers(io, socket, reconnectTimers);
    registerTeamHandlers(io, socket);
  });

  return { io, reconnectTimers };
}
import {
  joinOrResumeRoom,
  setPlayerReady,
  leaveRoom,
  markPlayerConnected,
  markPlayerDisconnected,
} from '../db/rooms.js';
import { broadcastRoomState } from '../ws/roomState.js';
import { withWsHandler } from '../ws/wsFaultIsolation.js';
import { bootstrapDuelIfReady } from '../ws/duelBootstrap.js';

const MAX_NICKNAME_LENGTH = 30;

/**
 * Registers the lobby event handlers for one connected socket. Every handler
 * runs inside withWsHandler so a DB fault (HttpError, pg error) is logged and
 * swallowed server-side instead of crashing the shared process (ADR-0001) —
 * mirrors engine/faultIsolation.js. Client-facing rejections (WsError) are
 * emitted to the socket as events.
 *
 * Identity comes from the auth middleware (socket.data.player); the room id
 * the socket is seated in is tracked in socket.data.roomId.
 */
export function registerRoomHandlers(io, socket, reconnectTimers) {
  socket.on('room:join', (payload) =>
    withWsHandler(socket, async () => {
      const { code } = payload ?? {};
      const playerId = socket.data.player.id;
      const nickname =
        typeof payload?.nickname === 'string' &&
        payload.nickname.trim().length > 0 &&
        payload.nickname.length <= MAX_NICKNAME_LENGTH
          ? payload.nickname
          : socket.data.player.nickname;

      const room = await joinOrResumeRoom(code, playerId, nickname);
      socket.data.roomId = room.id;
      socket.join(`room:${room.id}`);
      reconnectTimers.cancel(room.id, playerId);
      await markPlayerConnected(room.id, playerId);
      await broadcastRoomState(io, room.id);
    }),
  );

  socket.on('room:ready', (payload) =>
    withWsHandler(socket, async () => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.player.id;
      await setPlayerReady(roomId, playerId, Boolean(payload?.ready));
      await broadcastRoomState(io, roomId);
      // Item #5: when this ready completes a full ready 1v1 room, bootstrap
      // the duel (create duels + seed duel_pokemon_state + duel:start).
      await bootstrapDuelIfReady(io, roomId);
    }),
  );

  socket.on('room:leave', () =>
    withWsHandler(socket, async () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const playerId = socket.data.player.id;
      reconnectTimers.cancel(roomId, playerId);
      await leaveRoom(roomId, playerId);
      socket.data.roomId = undefined;
      await broadcastRoomState(io, roomId);
      socket.leave(`room:${roomId}`);
    }),
  );

  socket.on('disconnect', () =>
    withWsHandler(socket, async () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const playerId = socket.data.player.id;
      await markPlayerDisconnected(roomId, playerId);
      reconnectTimers.start(roomId, playerId, async () => {
        await leaveRoom(roomId, playerId);
        await broadcastRoomState(io, roomId);
      });
    }),
  );
}
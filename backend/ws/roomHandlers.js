import {
  joinOrResumeRoom,
  setPlayerReady,
  leaveOrCloseRoom,
  markPlayerConnected,
  markPlayerDisconnected,
} from '../db/rooms.js';
import { findActiveDuelForPlayer } from '../repositories/duelRepository.js';
import { broadcastRoomState } from '../ws/roomState.js';
import { withWsHandler } from '../ws/wsFaultIsolation.js';
import { bootstrapDuelIfReady } from '../ws/duelBootstrap.js';
import { createDuelLifecycle } from '../ws/duelLifecycle.js';

const MAX_NICKNAME_LENGTH = 30;

/**
 * Runs the room-leave/abandonment close-and-rank path (item #7, PR 2). Calls
 * leaveOrCloseRoom under its FOR UPDATE lock; when the room was closed-and-
 * ranked (closed:true) it broadcasts the room:final_ranking payload to the
 * whole room channel exactly once. For waiting/already-closed rooms it is a
 * pure pass-through (leaveOrCloseRoom delegates to the existing leaveRoom or
 * no-ops), so the pre-tournament and double-leave behaviors are unchanged.
 */
async function handleLeaveOrClose(io, roomId, playerId) {
  const result = await leaveOrCloseRoom(roomId, playerId);
  if (result.closed) {
    io.to(`room:${roomId}`).emit('room:final_ranking', {
      roomId: result.roomId,
      ranking: result.ranking,
    });
  }
}

/**
 * Registers the lobby event handlers for one connected socket. Every handler
 * runs inside withWsHandler so a DB fault (HttpError, pg error) is logged and
 * swallowed server-side instead of crashing the shared process (ADR-0001) —
 * mirrors engine/faultIsolation.js. Client-facing rejections (WsError) are
 * emitted to the socket as events.
 *
 * Identity comes from the auth middleware (socket.data.player); the room id
 * the socket is seated in is tracked in socket.data.roomId.
 *
 * `turnTimers` is the per-server turn-timer registry (composition root); the
 * disconnect listener needs it so a mid-duel forfeit cancels the correct
 * pending 10s turn window.
 */
export function registerRoomHandlers(io, socket, reconnectTimers, turnTimers) {
  const lifecycle = createDuelLifecycle({ turnTimers });
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
      await handleLeaveOrClose(io, roomId, playerId);
      socket.data.roomId = undefined;
      await broadcastRoomState(io, roomId);
      socket.leave(`room:${roomId}`);
    }),
  );

  socket.on('disconnect', () =>
    withWsHandler(socket, async () => {
      const playerId = socket.data.player.id;

      // Duel-membership branch FIRST (item #6, RF-6.2): a socket disconnecting
      // while its player's duel is `in_progress` forfeits that duel
      // immediately — no debounce, no 60s lobby grace. The DB query is
      // necessary because no `socket.data.duelId` field exists anywhere in the
      // WS layer (only room membership via socket.join).
      const activeDuel = await findActiveDuelForPlayer(playerId);
      if (activeDuel) {
        const { id: duelId, player1_id, player2_id } = activeDuel;
        const opponentId = playerId === player1_id ? player2_id : player1_id;
        await lifecycle.finishDuel(io, duelId, opponentId, 'disconnect');
        io.to(`duel:${duelId}`).emit('duel:opponent_disconnected', { duelId });
        return;
      }

      // Lobby/draft grace (RF-2.7): unchanged. Only reached when the player
      // has no live duel (no active duel, or duel still pending/finished).
      const roomId = socket.data.roomId;
      if (!roomId) return;
      await markPlayerDisconnected(roomId, playerId);
      reconnectTimers.start(roomId, playerId, async () => {
        await handleLeaveOrClose(io, roomId, playerId);
        await broadcastRoomState(io, roomId);
      });
    }),
  );
}
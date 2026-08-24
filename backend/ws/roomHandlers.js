import {
  joinOrResumeRoom,
  setPlayerReady,
  leaveOrCloseRoom,
  markPlayerConnected,
  markPlayerDisconnected,
  getRoomState,
} from '../db/rooms.js';
import { findActiveDuelForPlayer, findPendingBracketDuelForPlayer } from '../repositories/duelRepository.js';
import { broadcastRoomState } from '../ws/roomState.js';
import { withWsHandler } from '../ws/wsFaultIsolation.js';
import { bootstrapDuelIfReady, bootstrapBracketIfReady } from '../ws/duelBootstrap.js';
import { createDuelLifecycle } from '../ws/duelLifecycle.js';
import { advanceTournamentOrRematch, walkoverPendingDuel } from '../ws/tournamentLifecycle.js';

const MAX_NICKNAME_LENGTH = 30;

/** No-op fallback so the handlers stay safe if no registry is injected. */
const NOOP_WALKOVER_TIMERS = {
  arm() {},
  cancel() {
    return false;
  },
  has() {
    return false;
  },
  clear() {},
};

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
 * `turnTimers` is the per-server turn-timer registry and `bracketWalkoverTimers`
 * the per-server bracket-walkover registry (composition root) — the disconnect
 * listener needs them so a mid-duel forfeit cancels the correct pending 10s
 * window and a between-round 4p absence arms the right walkover window.
 */
export function registerRoomHandlers(
  io,
  socket,
  reconnectTimers,
  turnTimers,
  bracketWalkoverTimers = NOOP_WALKOVER_TIMERS,
) {
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
      // A reconnect within the bracket-walkover grace cancels the pending
      // walkover window (spec: "Reconnect within grace cancels the walkover").
      bracketWalkoverTimers.cancel(room.id, playerId);
      await markPlayerConnected(room.id, playerId);

      // socket.join above has ALREADY run unconditionally, so the channel
      // broadcast forms below are guaranteed to reach this socket. When the
      // room was aborted by boot reconciliation (ADR-0008), tell the player
      // the room is dead instead of broadcasting a normal room:state.
      if (room.status === 'aborted') {
        io.to(`room:${room.id}`).emit('room:aborted', {
          roomId: room.id,
          reason: 'server_restart',
        });
      } else {
        await broadcastRoomState(io, room.id);
      }
    }),
  );

  socket.on('room:ready', (payload) =>
    withWsHandler(socket, async () => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.player.id;
      await setPlayerReady(roomId, playerId, Boolean(payload?.ready));
      await broadcastRoomState(io, roomId);
      // Item #5: a full ready 1v1 room bootstraps its duel. Item #7 PR 3: a
      // full ready 4-player room opens its bracket (2 random semifinals).
      await bootstrapDuelIfReady(io, roomId);
      await bootstrapBracketIfReady(io, roomId);
    }),
  );

  socket.on('room:leave', () =>
    withWsHandler(socket, async () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const playerId = socket.data.player.id;
      reconnectTimers.cancel(roomId, playerId);
      bracketWalkoverTimers.cancel(roomId, playerId);

      // 4-player bracket (item #7, PR 3): an explicit leave between rounds is
      // an IMMEDIATE walkover of the player's pending duel (spec) — no 60s
      // grace. The seat is kept so the walked-over player still gets ranked
      // when the bracket completes ("total abandonment still closes normally").
      const room = await getRoomState(roomId);
      if (room && room.maxPlayers === 4 && room.status === 'in_progress') {
        await markPlayerDisconnected(roomId, playerId);
        await walkoverPendingDuel(io, roomId, playerId, { bracketWalkoverTimers });
        socket.data.roomId = undefined;
        await broadcastRoomState(io, roomId);
        socket.leave(`room:${roomId}`);
        return;
      }

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
      // WS layer (only room membership via socket.join). After the forfeit the
      // tournament lifecycle re-runs (item #7) so a 4p bracket advances when a
      // semifinal/final is forfeited by disconnect.
      const activeDuel = await findActiveDuelForPlayer(playerId);
      if (activeDuel) {
        const { id: duelId, room_id: activeRoomId, player1_id, player2_id } = activeDuel;
        const opponentId = playerId === player1_id ? player2_id : player1_id;
        await lifecycle.finishDuel(io, duelId, opponentId, 'disconnect');
        io.to(`duel:${duelId}`).emit('duel:opponent_disconnected', { duelId });
        await advanceTournamentOrRematch(io, activeRoomId, duelId, { bracketWalkoverTimers });
        return;
      }

      // Lobby/draft grace (RF-2.7): only reached when the player has no live
      // duel (no active duel, or duel still pending/finished).
      const roomId = socket.data.roomId;
      if (!roomId) return;

      // 4-player bracket between-round disconnect (item #7, PR 3): arm the
      // bracket-walkover timer for the player's pending duel instead of the
      // lobby reconnect timer (which would remove their seat). If the player
      // has no pending duel yet (e.g. semifinal done, finals not created), the
      // advanceTournamentOrRematch arm-site (b) catches it when finals pair.
      const room = await getRoomState(roomId);
      if (room && room.maxPlayers === 4 && room.status === 'in_progress') {
        await markPlayerDisconnected(roomId, playerId);
        const pending = await findPendingBracketDuelForPlayer(roomId, playerId);
        if (pending) {
          bracketWalkoverTimers.arm(roomId, playerId, () =>
            walkoverPendingDuel(io, roomId, playerId, { bracketWalkoverTimers }),
          );
        }
        return;
      }

      await markPlayerDisconnected(roomId, playerId);
      reconnectTimers.start(roomId, playerId, async () => {
        await handleLeaveOrClose(io, roomId, playerId);
        await broadcastRoomState(io, roomId);
      });
    }),
  );
}

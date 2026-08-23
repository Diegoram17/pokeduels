import { getRoomState } from '../db/rooms.js';

/**
 * Fetches the current lobby state for a room and broadcasts it as
 * `room:state` to every socket joined to the `room:{roomId}` channel.
 * No-op for unknown rooms (getRoomState returns undefined) — callers only
 * broadcast for rooms they just touched, so this guard is defensive.
 */
export async function broadcastRoomState(io, roomId) {
  const state = await getRoomState(roomId);
  if (!state) return;
  io.to(`room:${roomId}`).emit('room:state', state);
}
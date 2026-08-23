import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { HttpError } from '../lib/httpError.js';
import {
  joinOrResumeRoom,
  setPlayerReady,
  leaveRoom,
  markPlayerConnected,
  markPlayerDisconnected,
} from '../db/rooms.js';
import { broadcastRoomState } from '../ws/roomState.js';
import { registerRoomHandlers } from '../ws/roomHandlers.js';

// Handler-glue tests: the DB functions and the broadcast helper are mocked
// (their real behavior is covered by rooms.test.js / roomState.test.js), and
// the socket is a fake EventEmitter so we can drive the registered handlers
// with real payloads. A fake io object stands in for the Server instance.
vi.mock('../db/rooms.js', () => ({
  joinOrResumeRoom: vi.fn(),
  setPlayerReady: vi.fn(),
  leaveRoom: vi.fn(),
  markPlayerConnected: vi.fn(),
  markPlayerDisconnected: vi.fn(),
}));
vi.mock('../ws/roomState.js', () => ({
  broadcastRoomState: vi.fn(),
}));

describe('registerRoomHandlers', () => {
  let io;
  let socket;
  let reconnectTimers;
  let errorSpy;

  const room = { id: 7, code: 'ABC123', status: 'waiting', player_count: 2, resumed: false };

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    io = { to: vi.fn(() => ({ emit: vi.fn() })) };
    socket = new EventEmitter();
    socket.data = { player: { id: 5, nickname: 'AshDb' } };
    socket.join = vi.fn();
    reconnectTimers = {
      start: vi.fn(),
      cancel: vi.fn(() => false),
      has: vi.fn(() => false),
      clear: vi.fn(),
    };

    joinOrResumeRoom.mockResolvedValue(room);
    setPlayerReady.mockResolvedValue({ id: 1, ready: true });
    leaveRoom.mockResolvedValue(undefined);
    markPlayerConnected.mockResolvedValue(undefined);
    markPlayerDisconnected.mockResolvedValue(undefined);
    broadcastRoomState.mockResolvedValue(undefined);

    registerRoomHandlers(io, socket, reconnectTimers);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('room:join', () => {
    it('joins a new seat: resume-or-join, socket.join, cancel timer, mark connected, broadcast', async () => {
      socket.emit('room:join', { code: 'ABC123', nickname: 'Ash' });
      await vi.waitFor(() => expect(broadcastRoomState).toHaveBeenCalledWith(io, 7));

      expect(joinOrResumeRoom).toHaveBeenCalledWith('ABC123', 5, 'Ash');
      expect(socket.join).toHaveBeenCalledWith('room:7');
      expect(reconnectTimers.cancel).toHaveBeenCalledWith(7, 5);
      expect(markPlayerConnected).toHaveBeenCalledWith(7, 5);
      expect(socket.data.roomId).toBe(7);
    });

    it('falls back to the authenticated nickname when the payload omits one', async () => {
      socket.emit('room:join', { code: 'ABC123' });
      await vi.waitFor(() => expect(joinOrResumeRoom).toHaveBeenCalled());

      expect(joinOrResumeRoom).toHaveBeenCalledWith('ABC123', 5, 'AshDb');
    });

    it('swallows DB HttpErrors (e.g. unknown code) without crashing the socket', async () => {
      joinOrResumeRoom.mockRejectedValueOnce(new HttpError(404, 'room not found'));

      socket.emit('room:join', { code: 'NOPE00' });
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

      expect(socket.join).not.toHaveBeenCalled();
    });
  });

  describe('room:ready', () => {
    it('persists ready=true for the seated player and broadcasts', async () => {
      socket.data.roomId = 7;
      socket.emit('room:ready', { ready: true });
      await vi.waitFor(() => expect(setPlayerReady).toHaveBeenCalled());

      expect(setPlayerReady).toHaveBeenCalledWith(7, 5, true);
      expect(broadcastRoomState).toHaveBeenCalledWith(io, 7);
    });

    it('persists ready=false when the client un-readies', async () => {
      socket.data.roomId = 7;
      socket.emit('room:ready', { ready: false });
      await vi.waitFor(() => expect(setPlayerReady).toHaveBeenCalled());

      expect(setPlayerReady).toHaveBeenCalledWith(7, 5, false);
    });
  });

  describe('room:leave', () => {
    it('cancels any pending timer, removes the seat, clears roomId, and broadcasts', async () => {
      socket.data.roomId = 7;
      socket.emit('room:leave');
      await vi.waitFor(() => expect(leaveRoom).toHaveBeenCalled());

      expect(reconnectTimers.cancel).toHaveBeenCalledWith(7, 5);
      expect(leaveRoom).toHaveBeenCalledWith(7, 5);
      expect(socket.data.roomId).toBeUndefined();
      expect(broadcastRoomState).toHaveBeenCalledWith(io, 7);
    });
  });

  describe('native disconnect', () => {
    it('marks the player disconnected and arms the grace timer that removes the seat on expiry', async () => {
      socket.data.roomId = 7;
      socket.emit('disconnect');
      await vi.waitFor(() => expect(reconnectTimers.start).toHaveBeenCalled());

      expect(markPlayerDisconnected).toHaveBeenCalledWith(7, 5);
      expect(reconnectTimers.start).toHaveBeenCalledWith(7, 5, expect.any(Function));

      const onExpire = reconnectTimers.start.mock.calls[0][2];
      await onExpire();
      expect(leaveRoom).toHaveBeenCalledWith(7, 5);
      expect(broadcastRoomState).toHaveBeenCalledWith(io, 7);
    });

    it('is a no-op when the socket was never in a room', async () => {
      socket.emit('disconnect');
      await new Promise((r) => setTimeout(r, 20));
      expect(markPlayerDisconnected).not.toHaveBeenCalled();
      expect(reconnectTimers.start).not.toHaveBeenCalled();
    });
  });
});
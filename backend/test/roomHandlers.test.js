import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { HttpError } from '../lib/httpError.js';
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
import { bootstrapDuelIfReady, bootstrapBracketIfReady } from '../ws/duelBootstrap.js';
import { advanceTournamentOrRematch, walkoverPendingDuel } from '../ws/tournamentLifecycle.js';
import { registerRoomHandlers } from '../ws/roomHandlers.js';
import { logger } from '../lib/logger.js';

// Handler-glue tests: the DB functions and the broadcast helper are mocked
// (their real behavior is covered by rooms.test.js / roomState.test.js), and
// the socket is a fake EventEmitter so we can drive the registered handlers
// with real payloads. A fake io object stands in for the Server instance.
vi.mock('../db/rooms.js', () => ({
  joinOrResumeRoom: vi.fn(),
  setPlayerReady: vi.fn(),
  leaveOrCloseRoom: vi.fn(),
  markPlayerConnected: vi.fn(),
  markPlayerDisconnected: vi.fn(),
  getRoomState: vi.fn(),
}));
vi.mock('../ws/roomState.js', () => ({
  broadcastRoomState: vi.fn(),
}));
vi.mock('../ws/duelBootstrap.js', () => ({
  bootstrapDuelIfReady: vi.fn(),
  bootstrapBracketIfReady: vi.fn(),
}));
vi.mock('../repositories/duelRepository.js', () => ({
  findActiveDuelForPlayer: vi.fn(),
  findPendingBracketDuelForPlayer: vi.fn(),
  finishDuelByWalkover: vi.fn(),
}));
vi.mock('../ws/tournamentLifecycle.js', () => ({
  advanceTournamentOrRematch: vi.fn(),
  walkoverPendingDuel: vi.fn(),
}));

const mockLifecycle = { finishDuel: vi.fn(), finalizeDuelSideEffects: vi.fn() };
vi.mock('../ws/duelLifecycle.js', () => ({
  createDuelLifecycle: vi.fn(() => mockLifecycle),
}));

describe('registerRoomHandlers', () => {
  let io;
  let socket;
  let ctx;
  let reconnectTimers;
  let bracketWalkoverTimers;
  let errorSpy;

  const room = { id: 7, code: 'ABC123', status: 'waiting', player_count: 2, resumed: false };

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    io = { to: vi.fn(() => ({ emit: vi.fn() })) };
    socket = new EventEmitter();
    socket.data = { player: { id: 5, nickname: 'AshDb' } };
    socket.join = vi.fn();
    socket.leave = vi.fn();
    reconnectTimers = {
      start: vi.fn(),
      cancel: vi.fn(() => false),
      has: vi.fn(() => false),
      clear: vi.fn(),
    };
    bracketWalkoverTimers = {
      arm: vi.fn(),
      cancel: vi.fn(() => false),
      has: vi.fn(() => false),
      clear: vi.fn(),
    };

    joinOrResumeRoom.mockResolvedValue(room);
    setPlayerReady.mockResolvedValue({ id: 1, ready: true });
    leaveOrCloseRoom.mockResolvedValue({ closed: false });
    markPlayerConnected.mockResolvedValue(undefined);
    markPlayerDisconnected.mockResolvedValue(undefined);
    getRoomState.mockResolvedValue(undefined);
    broadcastRoomState.mockResolvedValue(undefined);
    bootstrapDuelIfReady.mockResolvedValue(undefined);
    bootstrapBracketIfReady.mockResolvedValue(undefined);
    findPendingBracketDuelForPlayer.mockResolvedValue(null);
    advanceTournamentOrRematch.mockResolvedValue(undefined);
    walkoverPendingDuel.mockResolvedValue({ applied: false });
    // No live duel by default: the disconnect listener falls through to the
    // lobby grace path (the pre-change behavior).
    findActiveDuelForPlayer.mockResolvedValue(null);

    // DuelContext composition root (spec A1): the handlers resolve the finish
    // lifecycle and the bracket-walkover registry from it. phaseStore/roundState
    // are threaded into the bracket-advance deps (A5 latent-bug gate #2).
    ctx = { lifecycle: mockLifecycle, bracketWalkoverTimers, phaseStore: { set: vi.fn(), get: vi.fn() }, roundState: { set: vi.fn(), get: vi.fn() } };
    registerRoomHandlers(io, socket, ctx, reconnectTimers);
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
      expect(bracketWalkoverTimers.cancel).toHaveBeenCalledWith(7, 5);
      expect(markPlayerConnected).toHaveBeenCalledWith(7, 5);
      expect(socket.data.roomId).toBe(7);
    });

    it('falls back to the authenticated nickname when the payload omits one', async () => {
      socket.emit('room:join', { code: 'ABC123' });
      await vi.waitFor(() => expect(joinOrResumeRoom).toHaveBeenCalled());

      expect(joinOrResumeRoom).toHaveBeenCalledWith('ABC123', 5, 'AshDb');
    });

    it('emits room:aborted instead of room:state when the joined room is aborted (post-reconciliation)', async () => {
      // Boot reconciliation (ADR-0008) aborts the room; a seated player
      // reconnecting must be told the room is dead — not get a room:state.
      joinOrResumeRoom.mockResolvedValueOnce({ ...room, status: 'aborted' });
      const emit = vi.fn();
      io.to.mockReturnValue({ emit });

      socket.emit('room:join', { code: 'ABC123', nickname: 'Ash' });
      await vi.waitFor(() => expect(emit).toHaveBeenCalled());

      // socket.join must still run FIRST so the channel broadcast reaches the
      // reconnecting socket (design ordering constraint).
      expect(socket.join).toHaveBeenCalledWith('room:7');
      expect(io.to).toHaveBeenCalledWith('room:7');
      expect(emit).toHaveBeenCalledWith('room:aborted', {
        roomId: 7,
        reason: 'server_restart',
      });
      expect(broadcastRoomState).not.toHaveBeenCalled();
    });

    it('translates a DB HttpError (unknown code) into a room:join_rejected event to the client', async () => {
      joinOrResumeRoom.mockRejectedValueOnce(new HttpError(404, 'room not found'));
      const rejected = vi.fn();
      socket.on('room:join_rejected', rejected);

      socket.emit('room:join', { code: 'NOPE00' });
      await vi.waitFor(() => expect(rejected).toHaveBeenCalled());

      expect(rejected).toHaveBeenCalledWith({ code: 'NOPE00', reason: 'not_found' });
      expect(socket.join).not.toHaveBeenCalled();
      // A translated WsError is a client-visible rejection, not a swallowed fault.
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('translates a full/not-waiting HttpError into room:join_rejected with reason unavailable', async () => {
      joinOrResumeRoom.mockRejectedValueOnce(new HttpError(409, 'room is full'));
      const rejected = vi.fn();
      socket.on('room:join_rejected', rejected);

      socket.emit('room:join', { code: 'ABC123' });
      await vi.waitFor(() => expect(rejected).toHaveBeenCalled());

      expect(rejected).toHaveBeenCalledWith({ code: 'ABC123', reason: 'unavailable' });
      expect(socket.join).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('rejects a payload nickname with control characters via room:join_rejected (invalid_nickname)', async () => {
      // A zero-width space (U+200B) is a Cf format char — the sanitizer must
      // reject it at the ingress before any join/INSERT (spec R1 scenario 4).
      const rejected = vi.fn();
      socket.on('room:join_rejected', rejected);

      socket.emit('room:join', { code: 'ABC123', nickname: 'Ash\u200bKetchum' });
      await vi.waitFor(() => expect(rejected).toHaveBeenCalled());

      expect(rejected).toHaveBeenCalledWith({ code: 'ABC123', reason: 'invalid_nickname' });
      expect(joinOrResumeRoom).not.toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
      // A client-visible rejection, not a swallowed fault.
      expect(errorSpy).not.toHaveBeenCalled();
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

    it('runs the duel bootstrap after the broadcast so a full ready 1v1 room starts a duel', async () => {
      socket.data.roomId = 7;
      socket.emit('room:ready', { ready: true });
      await vi.waitFor(() => expect(bootstrapDuelIfReady).toHaveBeenCalled());

      expect(broadcastRoomState).toHaveBeenCalledWith(io, 7);
      expect(bootstrapDuelIfReady).toHaveBeenCalledWith(io, 7, ctx);
    });

    it('also runs the bracket bootstrap so a full ready 4-player room opens its bracket', async () => {
      socket.data.roomId = 7;
      socket.emit('room:ready', { ready: true });
      await vi.waitFor(() => expect(bootstrapBracketIfReady).toHaveBeenCalled());

      expect(bootstrapBracketIfReady).toHaveBeenCalledWith(io, 7, ctx);
    });

    it('persists ready=false when the client un-readies', async () => {
      socket.data.roomId = 7;
      socket.emit('room:ready', { ready: false });
      await vi.waitFor(() => expect(setPlayerReady).toHaveBeenCalled());

      expect(setPlayerReady).toHaveBeenCalledWith(7, 5, false);
    });
  });

  describe('room:leave', () => {
    it('cancels any pending timer, runs close-and-rank, clears roomId, and broadcasts', async () => {
      socket.data.roomId = 7;
      socket.emit('room:leave');
      await vi.waitFor(() => expect(broadcastRoomState).toHaveBeenCalled());

      expect(reconnectTimers.cancel).toHaveBeenCalledWith(7, 5);
      expect(leaveOrCloseRoom).toHaveBeenCalledWith(7, 5);
      expect(socket.data.roomId).toBeUndefined();
      expect(broadcastRoomState).toHaveBeenCalledWith(io, 7);
    });

    it('emits room:final_ranking once when close-and-rank actually closes the room', async () => {
      socket.data.roomId = 7;
      const emit = vi.fn();
      io.to.mockReturnValue({ emit });
      leaveOrCloseRoom.mockResolvedValueOnce({
        closed: true,
        roomId: 7,
        ranking: [
          { playerId: 5, nickname: 'AshDb', finalRank: 1 },
          { playerId: 9, nickname: 'Other', finalRank: 2 },
        ],
      });

      socket.emit('room:leave');
      await vi.waitFor(() => expect(emit).toHaveBeenCalled());

      expect(io.to).toHaveBeenCalledWith('room:7');
      expect(emit).toHaveBeenCalledWith('room:final_ranking', {
        roomId: 7,
        ranking: [
          { playerId: 5, nickname: 'AshDb', finalRank: 1 },
          { playerId: 9, nickname: 'Other', finalRank: 2 },
        ],
      });
    });

    it('walks a 4-player bracket player over immediately on explicit leave between rounds (no 60s wait)', async () => {
      // A 4p in_progress room: an explicit room:leave between rounds is an
      // immediate walkover of the player's pending duel, not the close-and-rank
      // path (which would remove the seat and break the bracket).
      getRoomState.mockResolvedValue({
        roomId: 7,
        maxPlayers: 4,
        status: 'in_progress',
        players: [],
        startersTaken: [],
      });
      findPendingBracketDuelForPlayer.mockResolvedValueOnce({
        id: 40,
        round: 'semifinal',
        status: 'pending',
        player1_id: 5,
        player2_id: 99,
      });
      socket.data.roomId = 7;
      socket.emit('room:leave');
      await vi.waitFor(() => expect(walkoverPendingDuel).toHaveBeenCalled());

      expect(walkoverPendingDuel).toHaveBeenCalledWith(io, 7, 5, {
        bracketWalkoverTimers,
        lifecycle: mockLifecycle,
        phaseStore: ctx.phaseStore,
        roundState: ctx.roundState,
      });
      expect(leaveOrCloseRoom).not.toHaveBeenCalled();
      // The walkover timer (if any) is cancelled for the leaving player.
      expect(bracketWalkoverTimers.cancel).toHaveBeenCalledWith(7, 5);
      expect(socket.data.roomId).toBeUndefined();
    });
  });

  describe('native disconnect', () => {
    it('marks the player disconnected and arms the grace timer that closes the room on expiry', async () => {
      socket.data.roomId = 7;
      socket.emit('disconnect');
      await vi.waitFor(() => expect(reconnectTimers.start).toHaveBeenCalled());

      expect(markPlayerDisconnected).toHaveBeenCalledWith(7, 5);
      expect(reconnectTimers.start).toHaveBeenCalledWith(7, 5, expect.any(Function));

      const onExpire = reconnectTimers.start.mock.calls[0][2];
      await onExpire();
      expect(leaveOrCloseRoom).toHaveBeenCalledWith(7, 5);
      expect(broadcastRoomState).toHaveBeenCalledWith(io, 7);
    });

    it('is a no-op when the socket was never in a room', async () => {
      socket.emit('disconnect');
      await new Promise((r) => setTimeout(r, 20));
      expect(markPlayerDisconnected).not.toHaveBeenCalled();
      expect(reconnectTimers.start).not.toHaveBeenCalled();
    });

    it('forfeits a mid-duel disconnect via finishDuel + duel:opponent_disconnected, then re-advances the tournament', async () => {
      // P1 (id 5) is mid-duel against P2 (id 99) in duel 9 (room 7), in_progress.
      findActiveDuelForPlayer.mockResolvedValueOnce({
        id: 9,
        room_id: 7,
        player1_id: 5,
        player2_id: 99,
        status: 'in_progress',
      });
      const lifecycle = mockLifecycle;
      socket.data.roomId = 7;
      socket.emit('disconnect');
      await vi.waitFor(() => expect(lifecycle.finishDuel).toHaveBeenCalled());

      expect(findActiveDuelForPlayer).toHaveBeenCalledWith(5);
      expect(lifecycle.finishDuel).toHaveBeenCalledWith(io, 9, 99, 'disconnect');
      expect(io.to).toHaveBeenCalledWith('duel:9');
      // The tournament lifecycle re-runs so a 4p bracket advances on a
      // disconnect-forfeited semifinal/final.
      expect(advanceTournamentOrRematch).toHaveBeenCalledWith(io, 7, 9, {
        bracketWalkoverTimers,
        lifecycle: mockLifecycle,
        phaseStore: ctx.phaseStore,
        roundState: ctx.roundState,
      });
      // The lobby grace path is NOT taken for a mid-duel forfeit.
      expect(markPlayerDisconnected).not.toHaveBeenCalled();
      expect(reconnectTimers.start).not.toHaveBeenCalled();
    });

    it('arms a bracket-walkover timer for a 4-player between-round disconnect with a pending duel', async () => {
      // P1 (id 5) is between bracket rounds in a 4p in_progress room: no live
      // duel, but a pending semifinal awaits them. The walkover timer (not the
      // lobby reconnect timer) is armed so a silent absence times out.
      getRoomState.mockResolvedValue({
        roomId: 7,
        maxPlayers: 4,
        status: 'in_progress',
        players: [],
        startersTaken: [],
      });
      findPendingBracketDuelForPlayer.mockResolvedValueOnce({
        id: 30,
        round: 'semifinal',
        status: 'pending',
        player1_id: 5,
        player2_id: 99,
      });
      socket.data.roomId = 7;
      socket.emit('disconnect');
      await vi.waitFor(() => expect(bracketWalkoverTimers.arm).toHaveBeenCalled());

      expect(markPlayerDisconnected).toHaveBeenCalledWith(7, 5);
      expect(bracketWalkoverTimers.arm).toHaveBeenCalledWith(7, 5, expect.any(Function));
      // The lobby reconnect timer is skipped for a 4p bracket between-round case.
      expect(reconnectTimers.start).not.toHaveBeenCalled();
    });
  });
});
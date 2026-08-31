import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WsError } from '../lib/wsError.js';
import { logger } from '../lib/logger.js';
import { selectStarter, selectRoster } from '../db/teamSelections.js';
import { broadcastRoomState } from '../ws/roomState.js';
import { registerTeamHandlers } from '../ws/teamHandlers.js';

// Handler-glue tests. The DB selection functions are mocked (their pg-error →
// WsError mapping is covered by teamSelections.test.js), and the real
// withWsHandler runs, so these tests prove the handler → wrapper composition:
// WsErrors surface to the client as team:*_rejected events, broadcast follows
// success, and non-WsError faults are logged and swallowed.
vi.mock('../db/teamSelections.js', () => ({
  selectStarter: vi.fn(),
  selectRoster: vi.fn(),
}));
vi.mock('../ws/roomState.js', () => ({
  broadcastRoomState: vi.fn(),
}));

describe('registerTeamHandlers', () => {
  let io;
  let socket;
  let errorSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    // Faults flow through withWsHandler → the structured logger (spec R4).
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    io = { to: vi.fn(() => ({ emit: vi.fn() })) };
    // EventEmitter so the test can dispatch into registered handlers; the
    // emit spy wraps the original so client-facing emits are also captured.
    socket = new EventEmitter();
    socket.emit = vi.fn(socket.emit.bind(socket));
    socket.data = { player: { id: 5 }, roomId: 7 };

    selectStarter.mockResolvedValue({ id: 1 });
    selectRoster.mockResolvedValue([{ id: 1 }]);
    broadcastRoomState.mockResolvedValue(undefined);

    registerTeamHandlers(io, socket);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('team:select_starter', () => {
    it('reserves the starter for the seated player and broadcasts room state', async () => {
      socket.emit('team:select_starter', { pokemonId: 25 });
      await vi.waitFor(() => expect(broadcastRoomState).toHaveBeenCalled());

      expect(selectStarter).toHaveBeenCalledWith(7, 5, 25);
      expect(broadcastRoomState).toHaveBeenCalledWith(io, 7);
      expect(socket.emit).not.toHaveBeenCalledWith(
        'team:starter_rejected',
        expect.anything(),
      );
    });

    it('rejects a payload without pokemonId without touching the DB', async () => {
      socket.emit('team:select_starter', {});
      await vi.waitFor(() =>
        expect(socket.emit).toHaveBeenCalledWith('team:starter_rejected', {
          pokemonId: undefined,
          reason: 'invalid',
        }),
      );

      expect(selectStarter).not.toHaveBeenCalled();
      expect(broadcastRoomState).not.toHaveBeenCalled();
    });

    it('rejects a non-integer pokemonId', async () => {
      socket.emit('team:select_starter', { pokemonId: 'pikachu' });
      await vi.waitFor(() =>
        expect(socket.emit).toHaveBeenCalledWith('team:starter_rejected', {
          pokemonId: 'pikachu',
          reason: 'invalid',
        }),
      );
      expect(selectStarter).not.toHaveBeenCalled();
    });

    it('surfaces a DB-level exclusivity rejection to the client via withWsHandler', async () => {
      selectStarter.mockRejectedValueOnce(
        new WsError('team:starter_rejected', { pokemonId: 25, reason: 'taken' }),
      );

      socket.emit('team:select_starter', { pokemonId: 25 });
      await vi.waitFor(() =>
        expect(socket.emit).toHaveBeenCalledWith('team:starter_rejected', {
          pokemonId: 25,
          reason: 'taken',
        }),
      );

      expect(broadcastRoomState).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('team:select_roster', () => {
    it('selects the 5-pokemon roster and broadcasts room state', async () => {
      const ids = [1, 2, 3, 4, 5];
      socket.emit('team:select_roster', { pokemonIds: ids });
      await vi.waitFor(() => expect(broadcastRoomState).toHaveBeenCalled());

      expect(selectRoster).toHaveBeenCalledWith(7, 5, ids);
      expect(broadcastRoomState).toHaveBeenCalledWith(io, 7);
    });

    it('surfaces a validation rejection (invalid_count) to the client', async () => {
      selectRoster.mockRejectedValueOnce(
        new WsError('team:roster_rejected', { reason: 'invalid_count' }),
      );

      socket.emit('team:select_roster', { pokemonIds: [1, 2] });
      await vi.waitFor(() =>
        expect(socket.emit).toHaveBeenCalledWith('team:roster_rejected', {
          reason: 'invalid_count',
        }),
      );

      expect(broadcastRoomState).not.toHaveBeenCalled();
    });

    it('logs and swallows non-WsError faults (no client event)', async () => {
      selectRoster.mockRejectedValueOnce(new Error('pg exploded'));

      socket.emit('team:select_roster', { pokemonIds: [1, 2, 3, 4, 5] });
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

      expect(socket.emit).not.toHaveBeenCalledWith('team:roster_rejected', expect.anything());
      expect(broadcastRoomState).not.toHaveBeenCalled();
    });
  });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRoomState } from '../db/rooms.js';
import { broadcastRoomState } from '../ws/roomState.js';

// broadcastRoomState is thin glue: fetch the room state, then emit it to the
// room:{roomId} channel. The DB fetch is mocked (its real behavior is covered
// by the PR 1 integration tests in rooms.test.js); the io object is a fake
// capturing the target room and emitted payload.
vi.mock('../db/rooms.js', () => ({
  getRoomState: vi.fn(),
}));

describe('broadcastRoomState', () => {
  let io;
  let emitMock;

  beforeEach(() => {
    getRoomState.mockReset();
    emitMock = vi.fn();
    io = {
      to: vi.fn(() => ({ emit: emitMock })),
    };
  });

  it('emits room:state with the fetched state to room:{roomId}', async () => {
    const state = {
      roomId: 7,
      code: 'ABC123',
      status: 'waiting',
      maxPlayers: 4,
      players: [{ playerId: 1, nickname: 'Ash', ready: true, connected: true }],
      startersTaken: [25],
    };
    getRoomState.mockResolvedValue(state);

    await broadcastRoomState(io, 7);

    expect(getRoomState).toHaveBeenCalledWith(7);
    expect(io.to).toHaveBeenCalledWith('room:7');
    expect(emitMock).toHaveBeenCalledWith('room:state', state);
  });

  it('targets a different room name for a different roomId', async () => {
    getRoomState.mockResolvedValue({ roomId: 42 });
    await broadcastRoomState(io, 42);
    expect(io.to).toHaveBeenCalledWith('room:42');
  });

  it('does nothing when the room state is unknown (no roomId in io.to)', async () => {
    getRoomState.mockResolvedValue(undefined);
    await broadcastRoomState(io, 99);
    expect(io.to).not.toHaveBeenCalled();
  });
});
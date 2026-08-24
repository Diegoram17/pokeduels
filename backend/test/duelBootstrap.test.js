import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetPhaseStore, getPhaseStore } from '../engine/duelPhaseStore.js';
import { resetRoundStateStore, getRoundStateStore } from '../ws/duelRoundState.js';

// Unit tests for the 1v1 duel-bootstrap readiness gate (item #7, PR 1 rematch).
// `bootstrapDuelIfReady` is driven purely by the room state it reads via
// `getRoomState` (mocked) and the duel it creates via `createDuelFromRoom`
// (mocked). The engine phase store + WS round sub-state store are the real
// singletons (they are in-memory Maps, so a mock would be testing a mock).
vi.mock('../db/rooms.js', () => ({
  getRoomState: vi.fn(),
}));
vi.mock('../repositories/duelRepository.js', () => ({
  createDuelFromRoom: vi.fn(),
}));

import { getRoomState } from '../db/rooms.js';
import { createDuelFromRoom } from '../repositories/duelRepository.js';
import { bootstrapDuelIfReady } from '../ws/duelBootstrap.js';

/** A room state whose players are all ready — the pre-bootstrap precondition. */
function ready1v1Room(status) {
  return {
    roomId: 7,
    status,
    maxPlayers: 2,
    players: [
      { playerId: 1, nickname: 'A', ready: true },
      { playerId: 2, nickname: 'B', ready: true },
    ],
    startersTaken: [],
  };
}

describe('bootstrapDuelIfReady gate (item #7, PR 1 rematch)', () => {
  const io = { to: vi.fn(() => ({ emit: vi.fn() })) };

  beforeEach(() => {
    vi.clearAllMocks();
    resetPhaseStore();
    resetRoundStateStore();
    createDuelFromRoom.mockResolvedValue({ id: 42, status: 'pending' });
  });

  afterEach(() => {
    resetPhaseStore();
    resetRoundStateStore();
  });

  it('bootstraps a second duel in an in_progress 1v1 room with no active duel (rematch)', async () => {
    // Rematch state: the room stayed `in_progress` after the first duel
    // finished (item #7 decouples duel-finish from room-close); both players
    // re-readied. The old gate (`status !== 'waiting'`) blocked this.
    getRoomState.mockResolvedValue(ready1v1Room('in_progress'));

    const duel = await bootstrapDuelIfReady(io, 7);

    expect(duel).toEqual({ id: 42, status: 'pending' });
    expect(createDuelFromRoom).toHaveBeenCalledWith(7, 1, 2);
    // The fresh duel is registered for lead selection in the WS sub-state.
    expect(getRoundStateStore().get(42)).toBe('AWAITING_LEAD');
    expect(getPhaseStore().get(42)).toBe('lead_selection');
    expect(io.to).toHaveBeenCalledWith('room:7');
  });

  it('does NOT bootstrap a 1v1 room already in finished status', async () => {
    // A room that closed (rooms.status='finished') must never open a new duel.
    getRoomState.mockResolvedValue(ready1v1Room('finished'));

    const duel = await bootstrapDuelIfReady(io, 7);

    expect(duel).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('still bootstraps a full waiting 1v1 room (regression — first duel)', async () => {
    getRoomState.mockResolvedValue(ready1v1Room('waiting'));

    const duel = await bootstrapDuelIfReady(io, 7);

    expect(duel).toEqual({ id: 42, status: 'pending' });
    expect(createDuelFromRoom).toHaveBeenCalledWith(7, 1, 2);
  });

  it('does NOT bootstrap when the room is not full or not every player is ready', async () => {
    getRoomState.mockResolvedValue({
      roomId: 7,
      status: 'waiting',
      maxPlayers: 2,
      players: [{ playerId: 1, nickname: 'A', ready: true }], // only one seated
      startersTaken: [],
    });

    expect(await bootstrapDuelIfReady(io, 7)).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();

    // Full room but one player not ready.
    getRoomState.mockResolvedValue({
      roomId: 7,
      status: 'waiting',
      maxPlayers: 2,
      players: [
        { playerId: 1, nickname: 'A', ready: true },
        { playerId: 2, nickname: 'B', ready: false },
      ],
      startersTaken: [],
    });
    expect(await bootstrapDuelIfReady(io, 7)).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();
  });

  it('returns undefined for an unknown room (getRoomState null)', async () => {
    getRoomState.mockResolvedValue(undefined);
    expect(await bootstrapDuelIfReady(io, 999)).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();
  });
});

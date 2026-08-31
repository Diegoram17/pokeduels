import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPhaseStore } from '../engine/duelPhaseStore.js';
import { createRoundStateStore } from '../ws/duelRoundState.js';

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
import { bootstrapDuelIfReady, bootstrapBracketIfReady } from '../ws/duelBootstrap.js';

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

// The bootstrap functions resolve the phase/round stores from the DuelContext
// (spec A1). A1-3b: fresh factory stores per ctx — exactly what the context
// produces (the module singletons are deleted). Each test builds its own ctx so
// assertions observe the same instances the bootstrap wrote to.
function makeCtx() {
  return { phaseStore: createPhaseStore(), roundState: createRoundStateStore() };
}

describe('bootstrapDuelIfReady gate (item #7, PR 1 rematch)', () => {
  const io = { to: vi.fn(() => ({ emit: vi.fn() })) };

  beforeEach(() => {
    vi.clearAllMocks();
    createDuelFromRoom.mockResolvedValue({ id: 42, status: 'pending' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('bootstraps a second duel in an in_progress 1v1 room with no active duel (rematch)', async () => {
    // Rematch state: the room stayed `in_progress` after the first duel
    // finished (item #7 decouples duel-finish from room-close); both players
    // re-readied. The old gate (`status !== 'waiting'`) blocked this.
    getRoomState.mockResolvedValue(ready1v1Room('in_progress'));

    const ctx = makeCtx();
    const duel = await bootstrapDuelIfReady(io, 7, ctx);

    expect(duel).toEqual({ id: 42, status: 'pending' });
    expect(createDuelFromRoom).toHaveBeenCalledWith(7, 1, 2);
    // The fresh duel is registered for lead selection in the WS sub-state.
    expect(ctx.roundState.get(42)).toBe('AWAITING_LEAD');
    expect(ctx.phaseStore.get(42)).toBe('lead_selection');
    expect(io.to).toHaveBeenCalledWith('room:7');
  });

  it('does NOT bootstrap a 1v1 room already in finished status', async () => {
    // A room that closed (rooms.status='finished') must never open a new duel.
    getRoomState.mockResolvedValue(ready1v1Room('finished'));

    const duel = await bootstrapDuelIfReady(io, 7, makeCtx());

    expect(duel).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('still bootstraps a full waiting 1v1 room (regression — first duel)', async () => {
    getRoomState.mockResolvedValue(ready1v1Room('waiting'));

    const duel = await bootstrapDuelIfReady(io, 7, makeCtx());

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

    expect(await bootstrapDuelIfReady(io, 7, makeCtx())).toBeUndefined();
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
    expect(await bootstrapDuelIfReady(io, 7, makeCtx())).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();
  });

  it('returns undefined for an unknown room (getRoomState null)', async () => {
    getRoomState.mockResolvedValue(undefined);
    expect(await bootstrapDuelIfReady(io, 999, makeCtx())).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();
  });
});

describe('bootstrapBracketIfReady (item #7, PR 3 — 4-player bracket pairing)', () => {
  const io = { to: vi.fn(() => ({ emit: vi.fn() })) };
  // Identity shuffle keeps the pairing deterministic: p1/p2 -> semiA, p3/p4 -> semiB.
  const identityShuffle = (arr) => [...arr];

  /** A 4-player room state with every seat ready — the bracket precondition. */
  function ready4Room(status) {
    return {
      roomId: 7,
      status,
      maxPlayers: 4,
      players: [
        { playerId: 1, nickname: 'A', ready: true },
        { playerId: 2, nickname: 'B', ready: true },
        { playerId: 3, nickname: 'C', ready: true },
        { playerId: 4, nickname: 'D', ready: true },
      ],
      startersTaken: [],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates two semifinals with the shuffled pairing and broadcasts tournament:bracket + 2x duel:start', async () => {
    getRoomState.mockResolvedValue(ready4Room('waiting'));
    createDuelFromRoom
      .mockResolvedValueOnce({ id: 101, status: 'pending' }) // semiA
      .mockResolvedValueOnce({ id: 102, status: 'pending' }); // semiB

    const ctx = makeCtx();
    const result = await bootstrapBracketIfReady(io, 7, ctx, identityShuffle);

    expect(createDuelFromRoom).toHaveBeenNthCalledWith(1, 7, 1, 2, 'semifinal');
    expect(createDuelFromRoom).toHaveBeenNthCalledWith(2, 7, 3, 4, 'semifinal');
    expect(result).toEqual({ semiA: { id: 101, status: 'pending' }, semiB: { id: 102, status: 'pending' } });

    // Both semifinal duels are registered for lead selection, exactly like the
    // 1v1 bootstrap does (A5 latent-bug gate #2: without this, the F1 phase
    // guard rejects every bracket duel:select_lead — the bracket was
    // unplayable over WS).
    expect(ctx.phaseStore.get(101)).toBe('lead_selection');
    expect(ctx.phaseStore.get(102)).toBe('lead_selection');
    expect(ctx.roundState.get(101)).toBe('AWAITING_LEAD');
    expect(ctx.roundState.get(102)).toBe('AWAITING_LEAD');

    // tournament:bracket carries the two semifinal pairings by slot.
    expect(io.to).toHaveBeenCalledWith('room:7');
    const emitted = io.to.mock.results.map((r) => r.value.emit);
    const bracketCall = emitted.find((e) => e.mock.calls.some((c) => c[0] === 'tournament:bracket'));
    expect(bracketCall).toBeTruthy();
    expect(bracketCall.mock.calls[0][1]).toEqual({
      roomId: 7,
      bracket: {
        semiA: { duelId: 101, playerA: 1, playerB: 2 },
        semiB: { duelId: 102, playerA: 3, playerB: 4 },
      },
    });
    // Both semifinal duels are announced with a duel:start broadcast.
    const startCalls = emitted.flatMap((e) => e.mock.calls.filter((c) => c[0] === 'duel:start'));
    expect(startCalls).toHaveLength(2);
  });

  it('does NOT bootstrap when not all 4 seats are ready or the room is not waiting', async () => {
    // Not every seat ready.
    getRoomState.mockResolvedValue({
      roomId: 7,
      status: 'waiting',
      maxPlayers: 4,
      players: [
        { playerId: 1, nickname: 'A', ready: true },
        { playerId: 2, nickname: 'B', ready: true },
        { playerId: 3, nickname: 'C', ready: true },
        { playerId: 4, nickname: 'D', ready: false },
      ],
      startersTaken: [],
    });
    expect(await bootstrapBracketIfReady(io, 7, makeCtx(), identityShuffle)).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();

    // All ready but the room already left 'waiting' (duel already created).
    getRoomState.mockResolvedValue(ready4Room('in_progress'));
    expect(await bootstrapBracketIfReady(io, 7, makeCtx(), identityShuffle)).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('returns undefined for a non-4-player room (1v1 is bootstrapDuelIfReady\'s job)', async () => {
    getRoomState.mockResolvedValue({
      roomId: 7,
      status: 'waiting',
      maxPlayers: 2,
      players: [
        { playerId: 1, nickname: 'A', ready: true },
        { playerId: 2, nickname: 'B', ready: true },
      ],
      startersTaken: [],
    });
    expect(await bootstrapBracketIfReady(io, 7, makeCtx(), identityShuffle)).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('returns undefined for an unknown room', async () => {
    getRoomState.mockResolvedValue(undefined);
    expect(await bootstrapBracketIfReady(io, 999, makeCtx(), identityShuffle)).toBeUndefined();
    expect(createDuelFromRoom).not.toHaveBeenCalled();
  });
});

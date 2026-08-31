import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTurnCycle } from '../ws/turnCycle.js';

// Unit tests for the per-duel action buffer + shared resolution trigger
// (item #5). Buffer mechanics are pure; the missing-player timeout fill and
// resolution paths need the canonical duel state, so the repository module is
// mocked (design-authorized: pure-function tests, no DB — mirrors
// teamSelections unit tests). The full resolution happy path is covered by the
// WS integration tests (duelHandlers.ws.test.js).
vi.mock('../repositories/duelRepository.js', () => ({
  getDuelState: vi.fn(),
  mapDuelStateToCamelCase: vi.fn(),
  mapRoundEventsToCamelCase: vi.fn(),
}));
vi.mock('../engine/roundResolver.js', () => ({
  resolverRonda: vi.fn(),
}));
vi.mock('../ws/duelLifecycle.js', () => ({
  finalizeDuelSideEffects: vi.fn(async () => {}),
}));
vi.mock('../ws/tournamentLifecycle.js', () => ({
  advanceTournamentOrRematch: vi.fn(async () => {}),
}));

import { getDuelState, mapDuelStateToCamelCase, mapRoundEventsToCamelCase } from '../repositories/duelRepository.js';
import { resolverRonda } from '../engine/roundResolver.js';
import { advanceTournamentOrRematch } from '../ws/tournamentLifecycle.js';
import { createRoundStateStore } from '../ws/duelRoundState.js';
import { createPhaseStore } from '../engine/duelPhaseStore.js';

describe('createTurnCycle buffer mechanics', () => {
  let cycle;

  beforeEach(() => {
    vi.clearAllMocks();
    cycle = createTurnCycle();
  });

  it('bufferAction reports isFirst for the first action and pairComplete only once both players act', () => {
    const first = cycle.bufferAction(7, 1, { moveIndex: 4 });
    expect(first).toEqual({ isFirst: true, pairComplete: false });

    const second = cycle.bufferAction(7, 2, { moveIndex: 2 });
    expect(second).toEqual({ isFirst: false, pairComplete: true });
  });

  it('a re-pick replaces the same player action instead of counting twice', () => {
    cycle.bufferAction(7, 1, { moveIndex: 4 });
    const repick = cycle.bufferAction(7, 1, { moveIndex: 3 });
    expect(repick).toEqual({ isFirst: false, pairComplete: false });

    const second = cycle.bufferAction(7, 2, { moveIndex: 4 });
    expect(second.pairComplete).toBe(true);
  });

  it('buffers are isolated per duel', () => {
    cycle.bufferAction(7, 1, { moveIndex: 4 });
    const other = cycle.bufferAction(8, 1, { moveIndex: 4 });
    expect(other).toEqual({ isFirst: true, pairComplete: false });
  });

  it('clear() drops every buffered action', () => {
    cycle.bufferAction(7, 1, { moveIndex: 4 });
    cycle.bufferAction(7, 2, { moveIndex: 4 });
    cycle.clear();
    expect(cycle.hasBuffered(7)).toBe(false);
  });
});

describe('createTurnCycle dropBuffer (per-duel buffer cleanup)', () => {
  let cycle;

  beforeEach(() => {
    vi.clearAllMocks();
    cycle = createTurnCycle();
  });

  it('drops only the target duel\'s buffer, leaving other duels\' buffers intact', () => {
    cycle.bufferAction(7, 1, { moveIndex: 4 });
    cycle.bufferAction(7, 2, { moveIndex: 4 });
    cycle.bufferAction(8, 1, { moveIndex: 4 });

    cycle.dropBuffer(7);

    expect(cycle.hasBuffered(7)).toBe(false);
    expect(cycle.hasBuffered(8)).toBe(true);
  });

  it('is a silent no-op on a duel with no buffer', () => {
    expect(() => cycle.dropBuffer(7)).not.toThrow();
    expect(cycle.hasBuffered(7)).toBe(false);
  });

  it('is a no-op on a missing key without touching other duels', () => {
    cycle.bufferAction(8, 1, { moveIndex: 4 });
    cycle.dropBuffer(999);
    expect(cycle.hasBuffered(8)).toBe(true);
  });

  it('allows re-buffering a duel after its buffer was dropped', () => {
    cycle.bufferAction(7, 1, { moveIndex: 4 });
    cycle.dropBuffer(7);
    const first = cycle.bufferAction(7, 1, { moveIndex: 3 });
    expect(first).toEqual({ isFirst: true, pairComplete: false });
  });
});

describe('createTurnCycle resolution short-circuits', () => {
  let cycle;
  const io = { to: vi.fn(() => ({ emit: vi.fn() })) };

  beforeEach(() => {
    vi.clearAllMocks();
    cycle = createTurnCycle();
  });

  it('attemptResolveTurn returns false when nothing is buffered', async () => {
    expect(await cycle.attemptResolveTurn(io, 7)).toBe(false);
  });

  it('attemptResolveTurn returns false when only one action is buffered', async () => {
    cycle.bufferAction(7, 1, { moveIndex: 4 });
    expect(await cycle.attemptResolveTurn(io, 7)).toBe(false);
  });
});

describe('createTurnCycle timeout fill', () => {
  let cycle;

  beforeEach(() => {
    vi.clearAllMocks();
    cycle = createTurnCycle();
  });

  it('bufferTimeoutAction fills the missing player with {moveIndex:4, wasTimeout:true} using canonical players', async () => {
    getDuelState.mockResolvedValue({
      duel: { id: 7, player1_id: 1, player2_id: 2 },
      pokemonStates: [],
    });
    cycle.bufferAction(7, 1, { moveIndex: 4 });

    const missing = await cycle.bufferTimeoutAction(7);
    expect(missing).toBe(2);

    const second = cycle.bufferAction(7, 2, { moveIndex: 1, wasTimeout: true });
    expect(second.pairComplete).toBe(true);
  });

  it('bufferTimeoutAction returns null when the buffer is already full', async () => {
    cycle.bufferAction(7, 1, { moveIndex: 4 });
    cycle.bufferAction(7, 2, { moveIndex: 4 });
    expect(await cycle.bufferTimeoutAction(7)).toBeNull();
  });

  it('bufferTimeoutAction returns null when no buffer exists', async () => {
    expect(await cycle.bufferTimeoutAction(7)).toBeNull();
  });

  it('bufferTimeoutAction returns null when both canonical players already acted', async () => {
    getDuelState.mockResolvedValue({
      duel: { id: 7, player1_id: 1, player2_id: 2 },
      pokemonStates: [],
    });
    cycle.bufferAction(7, 1, { moveIndex: 4 });
    cycle.bufferAction(7, 2, { moveIndex: 4 });
    expect(await cycle.bufferTimeoutAction(7)).toBeNull();
  });
});

describe('createTurnCycle duel:turn_resolved turnEvents payload (Fase 7, PR7)', () => {
  let cycle;
  let emit;
  let finalizeMock;

  const io = { to: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    // A1-3b: turnCycle is factory-injected with the round/phase stores and the
    // finish lifecycle is wired via bindLifecycle (no module singletons).
    finalizeMock = vi.fn(async () => {});
    cycle = createTurnCycle({
      roundState: createRoundStateStore(),
      phaseStore: createPhaseStore(),
      bracketWalkoverTimers: { arm() {}, cancel() {}, has() {}, clear() {} },
    });
    cycle.bindLifecycle({ finalizeDuelSideEffects: finalizeMock });
    emit = vi.fn();
    vi.mocked(io.to).mockReturnValue({ emit });
  });

  // The repository mapper is mocked; this implementation mirrors the real
  // mapRoundEventsToCamelCase contract (field pick, order preserved, [] on a
  // non-array — i.e. the resolverRonda no-op path).
  const identityMapper = (events) =>
    (Array.isArray(events) ? events : []).map((e) => ({
      type: e.type,
      playerId: e.playerId,
      moveIndex: e.moveIndex ?? null,
      damage: e.damage ?? null,
      effectiveness: e.effectiveness ?? null,
      fainted: e.fainted ?? false,
      reason: e.reason ?? null,
    }));

  function bufferBoth() {
    cycle.bufferAction(7, 1, { moveIndex: 4 });
    cycle.bufferAction(7, 2, { moveIndex: 2 });
  }

  it('includes turnEvents in server resolution order alongside all prior snapshot fields', async () => {
    const events = [
      { type: 'resolved', playerId: 2, moveIndex: 2, damage: 25, effectiveness: 1, fainted: false },
      { type: 'resolved', playerId: 1, moveIndex: 4, damage: 10, effectiveness: 2, fainted: true },
    ];
    mapRoundEventsToCamelCase.mockImplementation(identityMapper);
    resolverRonda.mockResolvedValue({ events, phase: 'awaiting_actions' });
    getDuelState.mockResolvedValue({
      duel: { id: 7, player1_id: 1, player2_id: 2, status: 'in_progress' },
      pokemonStates: [],
    });
    mapDuelStateToCamelCase.mockReturnValue({
      duelId: 7,
      turnNumber: 3,
      winnerId: null,
      endReason: null,
      pokemonStates: [],
    });

    bufferBoth();
    expect(await cycle.attemptResolveTurn(io, 7)).toBe(true);

    expect(mapRoundEventsToCamelCase).toHaveBeenCalledWith(events);
    const [eventName, payload] = emit.mock.calls[0];
    expect(eventName).toBe('duel:turn_resolved');
    // All prior snapshot fields present, plus the additive turnEvents in the
    // exact server resolution order (P2 resolved first, then P1).
    expect(payload).toEqual({
      duelId: 7,
      turnNumber: 3,
      winnerId: null,
      endReason: null,
      pokemonStates: [],
      turnEvents: [
        { type: 'resolved', playerId: 2, moveIndex: 2, damage: 25, effectiveness: 1, fainted: false, reason: null },
        { type: 'resolved', playerId: 1, moveIndex: 4, damage: 10, effectiveness: 2, fainted: true, reason: null },
      ],
    });
  });

  it('emits turnEvents: [] when resolverRonda no-ops (duel no longer in_progress)', async () => {
    mapRoundEventsToCamelCase.mockImplementation(identityMapper);
    resolverRonda.mockResolvedValue({ applied: false });
    getDuelState.mockResolvedValue({
      duel: { id: 7, player1_id: 1, player2_id: 2, status: 'pending' },
      pokemonStates: [],
    });
    mapDuelStateToCamelCase.mockReturnValue({
      duelId: 7,
      turnNumber: 1,
      winnerId: null,
      endReason: null,
      pokemonStates: [],
    });

    bufferBoth();
    expect(await cycle.attemptResolveTurn(io, 7)).toBe(true);

    const [eventName, payload] = emit.mock.calls[0];
    expect(eventName).toBe('duel:turn_resolved');
    expect(payload.turnEvents).toEqual([]);
    expect(payload.duelId).toBe(7); // snapshot fields still present
  });

  it('still carries turnEvents on a team-wipe turn (emit precedes the finished branch)', async () => {
    const events = [
      { type: 'resolved', playerId: 1, moveIndex: 4, damage: 10, effectiveness: 1, fainted: true },
    ];
    mapRoundEventsToCamelCase.mockImplementation(identityMapper);
    resolverRonda.mockResolvedValue({ events, phase: 'finished', winnerId: 1 });
    getDuelState.mockResolvedValue({
      duel: { id: 7, player1_id: 1, player2_id: 2, room_id: 99, status: 'finished', winner_id: 1 },
      pokemonStates: [],
    });
    mapDuelStateToCamelCase.mockReturnValue({
      duelId: 7,
      turnNumber: 3,
      winnerId: 1,
      endReason: 'ko',
      pokemonStates: [],
    });

    bufferBoth();
    expect(await cycle.attemptResolveTurn(io, 7)).toBe(true);

    const [eventName, payload] = emit.mock.calls[0];
    expect(eventName).toBe('duel:turn_resolved');
    expect(payload.turnEvents).toEqual([
      { type: 'resolved', playerId: 1, moveIndex: 4, damage: 10, effectiveness: 1, fainted: true, reason: null },
    ]);
    // The finished branch still ran after the emit.
    expect(finalizeMock).toHaveBeenCalled();
    expect(advanceTournamentOrRematch).toHaveBeenCalled();
  });
});
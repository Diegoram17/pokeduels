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
}));

import { getDuelState } from '../repositories/duelRepository.js';

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
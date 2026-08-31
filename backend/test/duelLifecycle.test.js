import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDuelLifecycle } from '../ws/duelLifecycle.js';
import { createTurnCycle } from '../ws/turnCycle.js';
import { createRoundStateStore, ROUND_SUB_STATES } from '../ws/duelRoundState.js';
import { createPhaseStore } from '../engine/duelPhaseStore.js';
import { PHASES } from '../engine/stateMachine.js';

// Unit tests for the centralized duel-finish lifecycle (item #6, PR 2).
//
// `finishDuel` persists via finishDuelWrite (module-mocked) and, only on
// `{applied:true}`, calls `finalizeDuelSideEffects`. `finalizeDuelSideEffects`
// cleans up per-duel timer/buffer/round sub-state and broadcasts `duel:finished`
// — and MUST NOT touch rooms.status or any bracket-advance signal (scope
// boundary owned by backlog #7). Both functions are exercised through the
// dependency-injected factory so each test spies on real objects (3 deps,
// no module mock except the repository write).
vi.mock('../repositories/duelRepository.js', () => ({
  finishDuelWrite: vi.fn(),
}));

import { finishDuelWrite } from '../repositories/duelRepository.js';

/** Builds an isolated lifecycle with spy dependencies and a mock io. */
function makeHarness({ applied = true } = {}) {
  const turnTimers = { cancel: vi.fn(), start: vi.fn(), has: vi.fn(), clear: vi.fn() };
  const turnCycle = createTurnCycle();
  const duelRoundState = createRoundStateStore();
  const phaseStore = createPhaseStore();
  const io = { to: vi.fn(() => ({ emit: vi.fn() })) };
  finishDuelWrite.mockResolvedValue({ applied });
  const lifecycle = createDuelLifecycle({ turnTimers, turnCycle, duelRoundState, phaseStore });
  return { turnTimers, turnCycle, duelRoundState, phaseStore, io, lifecycle };
}

describe('finishDuel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls finishDuelWrite with (duelId, winnerId, endReason) and returns {applied}', async () => {
    const { turnTimers, turnCycle, duelRoundState, io, lifecycle } =
      makeHarness({ applied: true });

    const result = await lifecycle.finishDuel(io, 7, 2, 'surrender');

    expect(finishDuelWrite).toHaveBeenCalledWith(7, 2, 'surrender');
    expect(result).toEqual({ applied: true });
    expect(turnTimers.cancel).toHaveBeenCalledTimes(1);
    expect(io.to).toHaveBeenCalledTimes(1);
  });

  it('finalizes side effects (cleans state + broadcasts) when applied=true', async () => {
    const { turnTimers, turnCycle, duelRoundState, io, lifecycle } =
      makeHarness({ applied: true });

    // A pending turn window, buffered action, and round sub-state to clean up.
    turnTimers.cancel.mockReturnValue(true);
    turnCycle.bufferAction(7, 1, { moveIndex: 4 });
    turnCycle.bufferAction(7, 2, { moveIndex: 4 });
    duelRoundState.set(7, ROUND_SUB_STATES.AWAITING_ACTIONS);

    await lifecycle.finishDuel(io, 7, 2, 'surrender');

    expect(turnTimers.cancel).toHaveBeenCalledWith(7);
    expect(turnCycle.hasBuffered(7)).toBe(false);
    expect(duelRoundState.get(7)).toBeUndefined();
    const room = io.to;
    expect(room).toHaveBeenCalledWith('duel:7');
    expect(room.mock.results[0].value.emit).toHaveBeenCalledWith('duel:finished', {
      duelId: 7,
      winnerId: 2,
      endReason: 'surrender',
    });
  });

  it('skips side effects entirely and returns {applied:false} when finishDuelWrite applied=false', async () => {
    const { turnTimers, turnCycle, duelRoundState, io, lifecycle } =
      makeHarness({ applied: false });

    const result = await lifecycle.finishDuel(io, 7, 2, 'surrender');

    expect(finishDuelWrite).toHaveBeenCalledWith(7, 2, 'surrender');
    expect(result).toEqual({ applied: false });
    expect(turnTimers.cancel).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
    // Buffers/round state untouched because the finish was not applied.
    expect(turnCycle.hasBuffered(7)).toBe(false);
    expect(duelRoundState.get(7)).toBeUndefined();
  });
});

describe('finalizeDuelSideEffects', () => {
  it('cancels the turn timer, drops the action buffer, and deletes round sub-state', async () => {
    const { turnTimers, turnCycle, duelRoundState, io, lifecycle } =
      makeHarness();

    turnTimers.cancel.mockReturnValue(true);
    turnCycle.bufferAction(7, 1, { moveIndex: 4 });
    turnCycle.bufferAction(7, 2, { moveIndex: 4 });
    duelRoundState.set(7, ROUND_SUB_STATES.RESOLVING);

    await lifecycle.finalizeDuelSideEffects(io, 7, 2, 'ko');

    expect(turnTimers.cancel).toHaveBeenCalledWith(7);
    expect(turnCycle.hasBuffered(7)).toBe(false);
    expect(duelRoundState.get(7)).toBeUndefined();
  });

  it('broadcasts duel:finished {winnerId, endReason} to room duel:{duelId}', async () => {
    const { io, lifecycle } = makeHarness();

    await lifecycle.finalizeDuelSideEffects(io, 42, 9, 'disconnect');

    expect(io.to).toHaveBeenCalledWith('duel:42');
    expect(io.to.mock.results[0].value.emit).toHaveBeenCalledWith('duel:finished', {
      duelId: 42,
      winnerId: 9,
      endReason: 'disconnect',
    });
  });

  it('emits only duel:finished — never rooms.status, a room event, or bracket-advance', async () => {
    const { io, lifecycle } = makeHarness();

    await lifecycle.finalizeDuelSideEffects(io, 7, 2, 'ko');

    // Only the one room channel for the duel was touched.
    expect(io.to).toHaveBeenCalledTimes(1);
    expect(io.to).toHaveBeenCalledWith('duel:7');
    const emitted = io.to.mock.results[0].value.emit.mock.calls.map((c) => c[0]);
    expect(emitted).toEqual(['duel:finished']);
    // No room/status or bracket events fired anywhere on io.
    expect(io.to.mock.calls.some(([channel]) => channel !== 'duel:7')).toBe(false);
  });

  it('is idempotent — a second call with no pending state still returns cleanly', async () => {
    const { turnTimers, turnCycle, duelRoundState, io, lifecycle } =
      makeHarness();

    await lifecycle.finalizeDuelSideEffects(io, 7, 2, 'ko');
    turnTimers.cancel.mockClear();
    const roomEmit = io.to.mock.results[0].value.emit;
    roomEmit.mockClear();

    await lifecycle.finalizeDuelSideEffects(io, 7, 2, 'ko');

    expect(turnTimers.cancel).toHaveBeenCalledWith(7);
    expect(io.to).toHaveBeenCalledWith('duel:7');
  });
});

describe('finalizeDuelSideEffects — phase store cleanup (F6)', () => {
  it('deletes the duel entry from the phase store after finalization', async () => {
    const { lifecycle, io, phaseStore } = makeHarness();
    phaseStore.set(7, PHASES.IN_PROGRESS);
    // Positive control: the entry is live before finalization.
    expect(phaseStore.get(7)).toBe(PHASES.IN_PROGRESS);

    await lifecycle.finalizeDuelSideEffects(io, 7, 2, 'ko');

    expect(phaseStore.get(7)).toBeUndefined();
  });

  it('returns the phase store to its pre-run baseline after N duels are finalized', async () => {
    const { lifecycle, io, phaseStore } = makeHarness();
    const duelIds = [11, 12, 13, 14, 15];
    for (const id of duelIds) {
      phaseStore.set(id, PHASES.IN_PROGRESS);
    }
    // Positive control: all N entries are live before any finalization.
    for (const id of duelIds) {
      expect(phaseStore.get(id)).toBe(PHASES.IN_PROGRESS);
    }

    for (const id of duelIds) {
      await lifecycle.finalizeDuelSideEffects(io, id, 2, 'ko');
    }

    // Baseline was empty (fresh store per harness); every entry attributable to
    // these duels must be gone, leaving the store back at baseline size.
    for (const id of duelIds) {
      expect(phaseStore.get(id)).toBeUndefined();
    }
  });
});

describe('finalizeDuelSideEffects regression — concurrent duels are isolated', () => {
  it('leaves a second in-progress duel\'s buffer and round sub-state untouched', async () => {
    const { turnTimers, turnCycle, duelRoundState, io, lifecycle } =
      makeHarness();

    // Duel 7 finishes; duel 8 is a concurrent in-progress duel mid-round.
    turnCycle.bufferAction(8, 1, { moveIndex: 4 });
    turnCycle.bufferAction(8, 2, { moveIndex: 4 });
    duelRoundState.set(8, ROUND_SUB_STATES.AWAITING_ACTIONS);

    await lifecycle.finalizeDuelSideEffects(io, 7, 2, 'ko');

    // Duel 8 is fully intact.
    expect(turnCycle.hasBuffered(8)).toBe(true);
    expect(duelRoundState.get(8)).toBe(ROUND_SUB_STATES.AWAITING_ACTIONS);
    // Duel 7 was cleaned.
    expect(turnCycle.hasBuffered(7)).toBe(false);
    expect(duelRoundState.get(7)).toBeUndefined();
    // Only duel 7's timer was cancelled.
    expect(turnTimers.cancel).toHaveBeenCalledWith(7);
    expect(turnTimers.cancel).not.toHaveBeenCalledWith(8);
  });
});

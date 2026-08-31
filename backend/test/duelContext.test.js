import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDuelContext } from '../ws/duelContext.js';

// A1-3b: the DuelContext is the composition-root registry constructed before
// any handler registration (spec A1). Slice 3b switches the context from
// DELEGATING to the deleted module singletons to FRESH createX() factories:
// two contexts share no state (fresh isolation replaces the reset*() test
// hatches — spec: "A fresh DuelContext per test MUST provide the same
// isolation the reset*() hatches provided"), collaborator identity within one
// context stays stable, and the two-phase bindLifecycle init wires the
// turnCycle finish path to the context-owned lifecycle (design Q4 / circular
// import break: turnCycle.js no longer imports duelLifecycle.js).
vi.mock('../repositories/duelRepository.js', () => ({
  getDuelState: vi.fn(),
  mapDuelStateToCamelCase: vi.fn(),
  mapRoundEventsToCamelCase: vi.fn(() => []),
  applyRoundResult: vi.fn(),
}));
vi.mock('../ws/tournamentLifecycle.js', () => ({
  advanceTournamentOrRematch: vi.fn(),
}));

import { getDuelState } from '../repositories/duelRepository.js';

const noopWalkover = { arm() {}, cancel() {}, has() {}, clear() {} };

describe('createDuelContext (A1-3b fresh factories)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all 7 members wired to real collaborators', () => {
    const bracketWalkoverTimers = { arm() {}, cancel() {}, has() {}, clear() {} };
    const ctx = createDuelContext({ bracketWalkoverTimers });

    // turnTimers: a working per-duel timer registry.
    ctx.turnTimers.start(1, () => {});
    expect(ctx.turnTimers.has(1)).toBe(true);
    expect(ctx.turnTimers.cancel(1)).toBe(true);
    expect(ctx.turnTimers.has(1)).toBe(false);

    // reconnectTimers: a working room:player grace registry.
    ctx.reconnectTimers.start(7, 5, () => {});
    expect(ctx.reconnectTimers.has(7, 5)).toBe(true);
    expect(ctx.reconnectTimers.cancel(7, 5)).toBe(true);

    // bracketWalkoverTimers: RECEIVED (injected), never context-owned.
    expect(ctx.bracketWalkoverTimers).toBe(bracketWalkoverTimers);
  });

  it('isolates fresh contexts — two DuelContexts share no state (spec A1)', () => {
    const a = createDuelContext({ bracketWalkoverTimers: noopWalkover });
    const b = createDuelContext({ bracketWalkoverTimers: noopWalkover });

    // No registry-less singleton is cached: each context owns its instances.
    expect(a.phaseStore).not.toBe(b.phaseStore);
    expect(a.roundState).not.toBe(b.roundState);
    expect(a.turnCycle).not.toBe(b.turnCycle);
    expect(a.turnTimers).not.toBe(b.turnTimers);

    // State written into one context is invisible to the other.
    a.phaseStore.set(42, 'in_progress');
    a.roundState.set(42, 'AWAITING_ACTIONS');
    a.turnCycle.bufferAction(42, 1, { moveIndex: 4 });
    expect(b.phaseStore.get(42)).toBeUndefined();
    expect(b.roundState.get(42)).toBeUndefined();
    expect(b.turnCycle.hasBuffered(42)).toBe(false);
  });

  it('keeps stable collaborator identity within one context (spec A1)', () => {
    const ctx = createDuelContext({ bracketWalkoverTimers: noopWalkover });
    expect(ctx.phaseStore).toBe(ctx.phaseStore);
    expect(ctx.roundState).toBe(ctx.roundState);
    expect(ctx.turnCycle).toBe(ctx.turnCycle);
    expect(ctx.turnTimers).toBe(ctx.turnTimers);
    expect(ctx.lifecycle).toBe(ctx.lifecycle);
  });

  it('binds the lifecycle to the context-owned turn-timer registry and phase store', async () => {
    const ctx = createDuelContext({ bracketWalkoverTimers: noopWalkover });
    ctx.turnTimers.start(7, () => {});
    ctx.phaseStore.set(7, 'in_progress');
    expect(ctx.turnTimers.has(7)).toBe(true);

    const io = { to: () => ({ emit() {} }) };
    await ctx.lifecycle.finalizeDuelSideEffects(io, 7, 2, 'ko');

    // The lifecycle must cancel on the context's registry (not some other one)
    // and evict the phase through the context's store.
    expect(ctx.turnTimers.has(7)).toBe(false);
    expect(ctx.phaseStore.get(7)).toBeUndefined();
  });

  it('wires bindLifecycle: the turnCycle finish path calls lifecycle.finalizeDuelSideEffects (two-phase init)', async () => {
    const ctx = createDuelContext({ bracketWalkoverTimers: noopWalkover });
    // A finished duel state: attemptResolveTurn's finish branch must route the
    // cleanup through the BOUND lifecycle — proving the turnCycle -> lifecycle
    // wiring set up by ctx construction (the circular-import break).
    getDuelState.mockResolvedValue({
      duel: { id: 7, player1_id: 1, player2_id: 2, status: 'finished', winner_id: 2, room_id: 5 },
      pokemonStates: [],
    });
    ctx.turnCycle.bufferAction(7, 1, { moveIndex: 4 });
    ctx.turnCycle.bufferAction(7, 2, { moveIndex: 4 });

    const spy = vi.spyOn(ctx.lifecycle, 'finalizeDuelSideEffects');
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) };
    const result = await ctx.turnCycle.attemptResolveTurn(io, 7);

    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledWith(io, 7, 2, 'ko');
  });
});
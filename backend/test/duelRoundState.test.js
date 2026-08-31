import { describe, it, expect } from 'vitest';
import {
  createRoundStateStore,
  ROUND_SUB_STATES,
} from '../ws/duelRoundState.js';

// WS-layer round sub-state store (item #5): a per-duel sub-state map
// (AWAITING_LEAD/AWAITING_SWITCH/AWAITING_ACTIONS/RESOLVING) plus a small
// lead-readiness Map<duelId, Set<playerId>>. Same factory + singleton shape
// as engine/duelPhaseStore.js; lives entirely in the WS layer and never
// touches engine/stateMachine.js.
describe('createRoundStateStore factory', () => {
  it('round-trips a sub-state via set/get', () => {
    const store = createRoundStateStore();
    store.set(7, ROUND_SUB_STATES.AWAITING_ACTIONS);
    expect(store.get(7)).toBe('AWAITING_ACTIONS');
  });

  it('returns undefined for an unknown duel', () => {
    const store = createRoundStateStore();
    expect(store.get(999)).toBeUndefined();
  });

  it('isolates instances — writes in one store never leak to another', () => {
    const a = createRoundStateStore();
    const b = createRoundStateStore();
    a.set(1, ROUND_SUB_STATES.AWAITING_LEAD);
    expect(a.get(1)).toBe('AWAITING_LEAD');
    expect(b.get(1)).toBeUndefined();
  });

  it('delete removes the sub-state and the lead readiness for a duel', () => {
    const store = createRoundStateStore();
    store.set(3, ROUND_SUB_STATES.AWAITING_ACTIONS);
    store.markLeadReady(3, 1);
    store.markLeadReady(3, 2);
    store.delete(3);
    expect(store.get(3)).toBeUndefined();
    expect(store.bothLeadsReady(3)).toBe(false);
  });

  it('clear empties sub-states and lead readiness', () => {
    const store = createRoundStateStore();
    store.set(1, ROUND_SUB_STATES.AWAITING_LEAD);
    store.markLeadReady(1, 1);
    store.set(2, ROUND_SUB_STATES.AWAITING_SWITCH);
    store.clear();
    expect(store.get(1)).toBeUndefined();
    expect(store.get(2)).toBeUndefined();
    expect(store.bothLeadsReady(1)).toBe(false);
  });

  it('exposes the four sub-state constants', () => {
    expect(ROUND_SUB_STATES).toEqual({
      AWAITING_LEAD: 'AWAITING_LEAD',
      AWAITING_SWITCH: 'AWAITING_SWITCH',
      AWAITING_ACTIONS: 'AWAITING_ACTIONS',
      RESOLVING: 'RESOLVING',
    });
  });
});

describe('lead readiness', () => {
  it('starts not ready for a duel nobody has marked', () => {
    const store = createRoundStateStore();
    expect(store.bothLeadsReady(5)).toBe(false);
  });

  it('is not ready with one lead marked', () => {
    const store = createRoundStateStore();
    store.markLeadReady(5, 1);
    expect(store.bothLeadsReady(5)).toBe(false);
  });

  it('is ready once both players marked', () => {
    const store = createRoundStateStore();
    store.markLeadReady(5, 1);
    store.markLeadReady(5, 2);
    expect(store.bothLeadsReady(5)).toBe(true);
  });

  it('markLeadReady is idempotent per player (re-pick does not double count)', () => {
    const store = createRoundStateStore();
    store.markLeadReady(5, 1);
    store.markLeadReady(5, 1);
    store.markLeadReady(5, 2);
    expect(store.bothLeadsReady(5)).toBe(true);
  });

  it('tracks readiness independently per duel', () => {
    const store = createRoundStateStore();
    store.markLeadReady(5, 1);
    store.markLeadReady(6, 1);
    store.markLeadReady(6, 2);
    expect(store.bothLeadsReady(5)).toBe(false);
    expect(store.bothLeadsReady(6)).toBe(true);
  });
});
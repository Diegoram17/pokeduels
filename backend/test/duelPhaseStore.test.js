import { describe, it, expect } from 'vitest';
import { createPhaseStore } from '../engine/duelPhaseStore.js';

describe('createPhaseStore factory', () => {
  it('returns a store whose set/get round-trips a phase', () => {
    const store = createPhaseStore();
    store.set(7, 'in_progress');
    expect(store.get(7)).toBe('in_progress');
  });

  it('returns undefined for an unknown duel', () => {
    const store = createPhaseStore();
    expect(store.get(999)).toBeUndefined();
  });

  it('isolates instances — writes in one store never leak to another', () => {
    const a = createPhaseStore();
    const b = createPhaseStore();
    a.set(1, 'lead_selection');
    expect(a.get(1)).toBe('lead_selection');
    expect(b.get(1)).toBeUndefined();
  });

  it('delete removes a duel entry', () => {
    const store = createPhaseStore();
    store.set(3, 'in_progress');
    store.delete(3);
    expect(store.get(3)).toBeUndefined();
  });

  it('clear empties the store', () => {
    const store = createPhaseStore();
    store.set(1, 'pending');
    store.set(2, 'in_progress');
    store.clear();
    expect(store.get(1)).toBeUndefined();
    expect(store.get(2)).toBeUndefined();
  });
});
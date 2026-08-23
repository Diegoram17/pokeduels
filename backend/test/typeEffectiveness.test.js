import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCache,
  loadTypeEffectivenessCache,
  getMultiplier,
  getEffectivenessCache,
  resetEffectivenessCache,
} from '../engine/typeEffectiveness.js';

beforeEach(() => {
  resetEffectivenessCache();
});

describe('createCache', () => {
  it('returns an empty cache by default', () => {
    const cache = createCache();
    expect(cache).toBeInstanceOf(Map);
    expect(cache.size).toBe(0);
  });

  it('builds a cache from effectiveness rows, normalizing numeric multipliers', () => {
    const rows = [
      { attacking_type: 'fire', defending_type: 'grass', multiplier: '2.0' },
      { attacking_type: 'fire', defending_type: 'fire', multiplier: '0.5' },
    ];
    const cache = createCache(rows);
    expect(cache.size).toBe(2);
    expect(getMultiplier(cache, 'fire', 'grass')).toBe(2);
    expect(getMultiplier(cache, 'fire', 'fire')).toBe(0.5);
  });
});

describe('getMultiplier', () => {
  it('returns the curated multiplier for a super-effective pair', () => {
    const cache = createCache([
      { attacking_type: 'electric', defending_type: 'water', multiplier: '2.0' },
    ]);
    expect(getMultiplier(cache, 'electric', 'water')).toBe(2);
  });

  it('returns 0.5 for a not-very-effective pair', () => {
    const cache = createCache([
      { attacking_type: 'fire', defending_type: 'fire', multiplier: '0.5' },
    ]);
    expect(getMultiplier(cache, 'fire', 'fire')).toBe(0.5);
  });

  it('throws when the type pair is absent from the cache', () => {
    const cache = createCache();
    expect(() => getMultiplier(cache, 'ghost', 'normal')).toThrow(
      /No type-effectiveness multiplier/,
    );
  });
});

describe('loadTypeEffectivenessCache', () => {
  it('loads the matrix rows from the pool into a lookup cache', async () => {
    const rows = [
      { attacking_type: 'fire', defending_type: 'grass', multiplier: '2.0' },
      { attacking_type: 'fire', defending_type: 'water', multiplier: '0.5' },
      { attacking_type: 'water', defending_type: 'fire', multiplier: '2.0' },
    ];
    const fakePool = { query: async () => ({ rows }) };

    const cache = await loadTypeEffectivenessCache(fakePool);

    expect(cache.size).toBe(3);
    expect(getMultiplier(cache, 'fire', 'grass')).toBe(2);
    expect(getMultiplier(cache, 'fire', 'water')).toBe(0.5);
    expect(getMultiplier(cache, 'water', 'fire')).toBe(2);
  });

  it('installs the loaded cache as the module singleton', async () => {
    const fakePool = {
      query: async () => ({
        rows: [{ attacking_type: 'fire', defending_type: 'fire', multiplier: '0.5' }],
      }),
    };

    const cache = await loadTypeEffectivenessCache(fakePool);

    expect(getEffectivenessCache()).toBe(cache);
  });
});

describe('getEffectivenessCache', () => {
  it('throws when no cache has been loaded yet', () => {
    expect(() => getEffectivenessCache()).toThrow(/not loaded/i);
  });
});
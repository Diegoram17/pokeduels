import { describe, it, expect, vi } from 'vitest';
import {
  createBracketWalkoverTimerRegistry,
  DEFAULT_BRACKET_WALKOVER_GRACE_MS,
} from '../ws/bracketWalkoverTimers.js';

// Unit tests for the between-round bracket-walkover timer registry (item #7,
// PR 3). A 4-player bracket player who silently disconnects while awaiting a
// pending duel gets a 60s grace window; if it expires without a reconnect the
// walkover callback fires (a timeout default-loss), and a reconnect (room:join)
// cancels it. Mirrors reconnectTimers.test.js: real setTimeout with a tiny
// injected graceMs, no fake timers.
describe('createBracketWalkoverTimerRegistry', () => {
  it('exports a 60s default grace (parity with the reconnect grace)', () => {
    expect(DEFAULT_BRACKET_WALKOVER_GRACE_MS).toBe(60_000);
  });

  it('fires onExpire once after the injected graceMs elapses and clears the pair', async () => {
    const registry = createBracketWalkoverTimerRegistry({ graceMs: 30 });
    const onExpire = vi.fn();

    registry.arm('room-1', 'player-1', onExpire);
    expect(registry.has('room-1', 'player-1')).toBe(true);

    await new Promise((r) => setTimeout(r, 90));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(registry.has('room-1', 'player-1')).toBe(false);
  });

  it('cancel() returns true while pending, clears the pair, and prevents expiry', async () => {
    const registry = createBracketWalkoverTimerRegistry({ graceMs: 20 });
    const onExpire = vi.fn();

    registry.arm('room-1', 'player-1', onExpire);
    const cancelled = registry.cancel('room-1', 'player-1');

    expect(cancelled).toBe(true);
    expect(registry.has('room-1', 'player-1')).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('cancel() returns false when no walkover timer is pending', () => {
    const registry = createBracketWalkoverTimerRegistry({ graceMs: 20 });
    expect(registry.cancel('room-1', 'player-1')).toBe(false);
    expect(registry.has('room-1', 'player-1')).toBe(false);
  });

  it('rearming the same pair replaces the previous timer instead of double-firing', async () => {
    const registry = createBracketWalkoverTimerRegistry({ graceMs: 30 });
    const first = vi.fn();
    const second = vi.fn();

    registry.arm('room-1', 'player-1', first);
    registry.arm('room-1', 'player-1', second); // pairing re-armed on a new round

    await new Promise((r) => setTimeout(r, 90));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clear() cancels every pending walkover window', async () => {
    const registry = createBracketWalkoverTimerRegistry({ graceMs: 20 });
    const a = vi.fn();
    const b = vi.fn();

    registry.arm('room-1', 'player-1', a);
    registry.arm('room-2', 'player-2', b);
    registry.clear();

    await new Promise((r) => setTimeout(r, 60));
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by the expire callback', async () => {
    const registry = createBracketWalkoverTimerRegistry({ graceMs: 20 });
    registry.arm('room-1', 'player-1', () => {
      throw new Error('boom');
    });

    await new Promise((r) => setTimeout(r, 60));
    expect(registry.has('room-1', 'player-1')).toBe(false);
  });
});

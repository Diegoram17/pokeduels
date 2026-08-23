import { describe, it, expect, vi } from 'vitest';
import { createTurnTimerRegistry, DEFAULT_TURN_TIMEOUT_MS } from '../ws/turnTimers.js';

// Unit tests for the per-duel 10s turn timer registry (item #5, design: the
// "value-producing" timer). Same factory + Map<key,Timeout> pattern as
// reconnectTimers.js, collapsed to a SINGLE-ARG key: duelId alone is already
// unique per duel, so there is no composite roomId:playerId key. Real
// setTimeout with a tiny injected timeoutMs (no fake timers), so expiry is
// observable on real wall-clock time.
describe('createTurnTimerRegistry', () => {
  it('exports a 10s default turn timeout', () => {
    expect(DEFAULT_TURN_TIMEOUT_MS).toBe(10_000);
  });

  it('fires onExpire once after the injected timeoutMs elapses', async () => {
    const registry = createTurnTimerRegistry({ timeoutMs: 30 });
    const onExpire = vi.fn();

    registry.start(7, onExpire);
    expect(registry.has(7)).toBe(true);

    await new Promise((r) => setTimeout(r, 90));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(registry.has(7)).toBe(false);
  });

  it('cancel() returns true while pending and prevents expiry', async () => {
    const registry = createTurnTimerRegistry({ timeoutMs: 20 });
    const onExpire = vi.fn();

    registry.start(7, onExpire);
    const cancelled = registry.cancel(7);

    expect(cancelled).toBe(true);
    expect(registry.has(7)).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('cancel() returns false when no timer is pending', () => {
    const registry = createTurnTimerRegistry({ timeoutMs: 20 });
    expect(registry.cancel(7)).toBe(false);
    expect(registry.has(7)).toBe(false);
  });

  it('clear() cancels every pending timer', async () => {
    const registry = createTurnTimerRegistry({ timeoutMs: 20 });
    const a = vi.fn();
    const b = vi.fn();

    registry.start(7, a);
    registry.start(8, b);
    registry.clear();

    await new Promise((r) => setTimeout(r, 60));
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('tracks timers independently per duelId', async () => {
    const registry = createTurnTimerRegistry({ timeoutMs: 25 });
    const a = vi.fn();
    const b = vi.fn();

    registry.start(7, a);
    registry.start(8, b);
    expect(registry.cancel(7)).toBe(true);

    await new Promise((r) => setTimeout(r, 70));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('restarting the same duel replaces the previous timer instead of double-firing', async () => {
    const registry = createTurnTimerRegistry({ timeoutMs: 30 });
    const first = vi.fn();
    const second = vi.fn();

    registry.start(7, first);
    registry.start(7, second); // re-pick / new round resets the window

    await new Promise((r) => setTimeout(r, 90));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('swallows errors thrown by the expire callback (timer runs outside the event loop)', async () => {
    const registry = createTurnTimerRegistry({ timeoutMs: 20 });
    registry.start(7, () => {
      throw new Error('boom');
    });

    await new Promise((r) => setTimeout(r, 60));
    expect(registry.has(7)).toBe(false);
  });
});
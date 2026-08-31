import { describe, it, expect, vi, afterEach } from 'vitest';
import { createReconnectTimerRegistry, DEFAULT_RECONNECT_GRACE_MS } from '../ws/reconnectTimers.js';
import { logger } from '../lib/logger.js';

// Unit tests for the reconnect grace-window registry (design: "Real setTimeout
// with a tiny injected graceMs, no fake timers"). The 60s production default
// is replaced by 20-40ms windows so expiry is observable in real wall-clock
// time without vi.useFakeTimers().
describe('createReconnectTimerRegistry', () => {
  it('exports a 60s default reconnect grace', () => {
    expect(DEFAULT_RECONNECT_GRACE_MS).toBe(60_000);
  });

  it('fires onExpire once after the injected graceMs elapses', async () => {
    const registry = createReconnectTimerRegistry({ graceMs: 30 });
    const onExpire = vi.fn();

    registry.start('room-1', 'player-1', onExpire);
    expect(registry.has('room-1', 'player-1')).toBe(true);

    await new Promise((r) => setTimeout(r, 90));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(registry.has('room-1', 'player-1')).toBe(false);
  });

  it('cancel() returns true while pending and prevents expiry', async () => {
    const registry = createReconnectTimerRegistry({ graceMs: 20 });
    const onExpire = vi.fn();

    registry.start('room-1', 'player-1', onExpire);
    const cancelled = registry.cancel('room-1', 'player-1');

    expect(cancelled).toBe(true);
    expect(registry.has('room-1', 'player-1')).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('cancel() returns false when no timer is pending', () => {
    const registry = createReconnectTimerRegistry({ graceMs: 20 });
    expect(registry.cancel('room-1', 'player-1')).toBe(false);
    expect(registry.has('room-1', 'player-1')).toBe(false);
  });

  it('clear() cancels every pending timer', async () => {
    const registry = createReconnectTimerRegistry({ graceMs: 20 });
    const a = vi.fn();
    const b = vi.fn();

    registry.start('room-1', 'player-1', a);
    registry.start('room-2', 'player-2', b);
    registry.clear();

    await new Promise((r) => setTimeout(r, 60));
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('tracks timers independently per roomId:playerId pair', async () => {
    const registry = createReconnectTimerRegistry({ graceMs: 25 });
    const a = vi.fn();
    const b = vi.fn();

    registry.start('room-1', 'player-1', a);
    registry.start('room-2', 'player-2', b);
    expect(registry.cancel('room-1', 'player-1')).toBe(true);

    await new Promise((r) => setTimeout(r, 70));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('restarting the same pair replaces the previous timer instead of double-firing', async () => {
    const registry = createReconnectTimerRegistry({ graceMs: 30 });
    const first = vi.fn();
    const second = vi.fn();

    registry.start('room-1', 'player-1', first);
    registry.start('room-1', 'player-1', second); // reconnect resets the window

    await new Promise((r) => setTimeout(r, 90));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('swallows errors thrown by the expire callback', async () => {
    const registry = createReconnectTimerRegistry({ graceMs: 20 });
    registry.start('room-1', 'player-1', () => {
      throw new Error('boom');
    });

    await new Promise((r) => setTimeout(r, 60));
    expect(registry.has('room-1', 'player-1')).toBe(false);
  });

  it('logs a structured error record when the expire callback throws', async () => {
    const registry = createReconnectTimerRegistry({ graceMs: 20 });
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    registry.start('room-1', 'player-1', () => {
      throw new Error('boom');
    });

    await new Promise((r) => setTimeout(r, 60));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        playerId: 'player-1',
        err: expect.any(Error),
      }),
      'reconnect-timer expire callback failed',
    );
    spy.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
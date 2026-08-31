import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Graceful-shutdown test for server.js (SIGTERM/SIGINT drain). The heavy
// boot-time deps that touch the DB are mocked so importing server.js never
// issues a query; the pool itself is real but only its `end` is exercised.
// The exported `shutdown()` seam lets win32 (which cannot deliver POSIX
// signals to the vitest worker) exercise the drain path directly; on Linux CI
// the signal handlers are also asserted to be registered.
vi.mock('../db/reconciliation.js', () => ({
  reconcileOrphanedDuels: vi.fn(async () => {}),
  reconcileStaleWaitingRooms: vi.fn(async () => {}),
}));
vi.mock('../engine/typeEffectiveness.js', () => ({
  loadTypeEffectivenessCache: vi.fn(async () => {}),
}));

describe('server.js graceful shutdown', () => {
  let exitSpy;
  let endSpy;

  beforeEach(async () => {
    vi.resetModules();
    process.env.PORT = '0';
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const { pool } = await import('../db/pool.js');
    endSpy = vi.spyOn(pool, 'end').mockResolvedValue();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    endSpy?.mockRestore();
  });

  it('exports a shutdown() that drains the pool and exits 0', async () => {
    const { shutdown } = await import('../server.js');

    await shutdown('SIGTERM');

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('is idempotent: a second shutdown call does not end the pool twice', async () => {
    const { shutdown } = await import('../server.js');

    await shutdown('SIGTERM');
    await shutdown('SIGINT');

    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it('registers SIGTERM and SIGINT handlers', async () => {
    await import('../server.js');

    expect(process.listenerCount('SIGTERM')).toBeGreaterThan(0);
    expect(process.listenerCount('SIGINT')).toBeGreaterThan(0);
  });
});
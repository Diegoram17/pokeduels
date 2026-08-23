import { describe, it, expect, vi, afterEach } from 'vitest';
import { withDuelFaultIsolation } from '../engine/faultIsolation.js';

/**
 * Per-duel fault isolation (design: PL1-06). withDuelFaultIsolation wraps ONLY
 * that duel's resolverRonda call: genuine faults/bugs are caught and returned
 * as { ok: false, error } without crashing the shared process; insufficient-PP
 * rejection is EXPECTED user input and never routed here — it surfaces as a
 * normal `rejected` event in the resolver's return value.
 */

describe('withDuelFaultIsolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok:true with the result when the wrapped fn resolves', async () => {
    const result = await withDuelFaultIsolation(7, async () => ({ events: [] }));
    expect(result).toEqual({ ok: true, result: { events: [] } });
  });

  it('catches a throwing async fn and returns { ok:false, error } without rethrowing', async () => {
    const error = new Error('boom');
    const result = await withDuelFaultIsolation(7, async () => {
      throw error;
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(error);
  });

  it('catches a throwing sync fn too (non-promise return)', async () => {
    const result = await withDuelFaultIsolation(7, () => {
      throw new Error('sync boom');
    });
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe('sync boom');
  });

  it('logs the failure loudly, including the duelId', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await withDuelFaultIsolation(42, async () => {
      throw new Error('kaboom');
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('42');
    expect(spy.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it('does not affect another duel: a failed duel A leaves duel B fully functional', async () => {
    const failed = await withDuelFaultIsolation(1, async () => {
      throw new Error('duel A exploded');
    });
    expect(failed).toEqual({ ok: false, error: failed.error });

    const healthy = await withDuelFaultIsolation(2, async () => 'round resolved');
    expect(healthy).toEqual({ ok: true, result: 'round resolved' });
  });

  it('treats an insufficient_pp rejection as a normal result, never as a fault', async () => {
    // resolverRonda's contract: a 0-PP move produces a { type: 'rejected',
    // reason: 'insufficient_pp' } event inside the normal return value. It is
    // never thrown, so the wrapper must report ok:true — routing a PP-reject
    // through fault isolation would misclassify expected input as a crash.
    const result = await withDuelFaultIsolation(7, async () => ({
      events: [
        { type: 'rejected', playerId: 1, moveIndex: 2, reason: 'insufficient_pp' },
      ],
      phase: 'in_progress',
    }));
    expect(result.ok).toBe(true);
    expect(result.result.events[0].reason).toBe('insufficient_pp');
  });
});
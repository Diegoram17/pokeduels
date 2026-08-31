import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/pool.js', () => ({
  pool: { connect: vi.fn() },
}));

import { pool } from '../db/pool.js';
import { withTransaction } from '../repositories/duelTransactions.js';

/**
 * withTransaction unit tests (A2): the shared BEGIN -> fn(client) -> COMMIT
 * wrapper that applyRoundResult / createDuelFromRoom / applySwitchDecision are
 * rewritten on top of. All three transaction bodies are covered by the
 * DB-gated integration suite; here we pin the wrapper's exact contract with
 * fakes: COMMIT happy path, swallowed ROLLBACK + original-error rethrow,
 * release() in finally on every path.
 */
function makeFakeClient({ rollbackRejects = false } = {}) {
  const queries = [];
  const client = {
    query: vi.fn(async (sql) => {
      queries.push(String(sql).split(/\s+/)[0]);
      if (rollbackRejects && String(sql).startsWith('ROLLBACK')) {
        throw new Error('rollback failed');
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, queries };
}

describe('withTransaction', () => {
  beforeEach(() => {
    pool.connect.mockReset();
  });

  it('runs BEGIN -> fn(client) -> COMMIT and returns fn\'s result', async () => {
    const { client, queries } = makeFakeClient();
    pool.connect.mockResolvedValue(client);

    const result = await withTransaction(async (tx) => {
      await tx.query('SELECT 1');
      return 42;
    });

    expect(result).toBe(42);
    expect(queries).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and rethrows the ORIGINAL error when fn throws (no COMMIT)', async () => {
    const { client, queries } = makeFakeClient();
    pool.connect.mockResolvedValue(client);

    const boom = new Error('boom');
    await expect(
      withTransaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(queries).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('swallows a ROLLBACK failure and still rethrows the original error', async () => {
    const { client } = makeFakeClient({ rollbackRejects: true });
    pool.connect.mockResolvedValue(client);

    const boom = new Error('boom');
    await expect(
      withTransaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('releases the client in finally even when BEGIN itself fails', async () => {
    const { client } = makeFakeClient();
    client.query.mockRejectedValueOnce(new Error('begin failed'));
    pool.connect.mockResolvedValue(client);

    await expect(
      withTransaction(async () => 'unreachable'),
    ).rejects.toThrow('begin failed');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
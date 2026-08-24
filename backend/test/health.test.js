import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';

/**
 * Spec: "Health check independent of DB availability" — GET /health must
 * still return 200 even when the database pool is unreachable or exhausted.
 * app.js's handler is a bare `res.status(200).end()` with zero references to
 * `pool`/`db`, so this test proves that independence at runtime (not just by
 * source inspection): it forces every pool.query call to reject — as it
 * would against a dead or exhausted connection — and confirms /health is
 * unaffected. No DATABASE_URL is required; the mocked pool never performs a
 * real connection.
 */
describe('GET /health', () => {
  it('returns 200 with an empty body even when the DB pool is unreachable/exhausted', async () => {
    const queryError = new Error('simulated: database pool unreachable');
    const querySpy = vi.spyOn(pool, 'query').mockRejectedValue(queryError);

    try {
      const app = createApp();
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.text).toBe('');

      // Sanity check the stub is genuinely active for the duration of the
      // request — proves this test would have failed had /health started
      // touching the DB (the mocked rejection is what "unreachable" means).
      await expect(pool.query('SELECT 1')).rejects.toThrow(queryError);
    } finally {
      querySpy.mockRestore();
    }
  });

  it('returns 200 with an empty body when the DB pool is healthy (baseline)', async () => {
    // Triangulation: same assertion, no DB fault injected — proves the 200
    // is not an artifact of the mock itself, and that /health behaves
    // identically regardless of pool state (the spec's "independent of DB
    // availability" claim, from both directions).
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.text).toBe('');
  });
});

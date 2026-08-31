import { describe, it, expect } from 'vitest';
import { resolvePoolConfig } from '../db/pool.js';

// Pure pool-config resolver (design: resolvePoolConfig(env) derives options
// ONLY from its env argument — defaults, numeric overrides, and NaN/garbage
// fallback without throwing).
describe('resolvePoolConfig', () => {
  it('returns sane defaults for an empty env', () => {
    const cfg = resolvePoolConfig({});
    expect(cfg.max).toBe(10);
    expect(cfg.keepAlive).toBe(true);
    expect(cfg.allowExitOnIdle).toBe(false);
    expect(cfg.connectionTimeoutMillis).toBe(10_000);
    expect(cfg.idleTimeoutMillis).toBe(30_000);
    expect(cfg.connectionString).toBeUndefined();
  });

  it('reads PG_POOL_MAX as a numeric override', () => {
    expect(resolvePoolConfig({ PG_POOL_MAX: '25' }).max).toBe(25);
  });

  it('falls back to the default for a non-numeric PG_POOL_MAX without throwing', () => {
    expect(resolvePoolConfig({ PG_POOL_MAX: 'abc' }).max).toBe(10);
  });

  it('falls back for empty, float, and negative values', () => {
    expect(resolvePoolConfig({ PG_POOL_MAX: '' }).max).toBe(10);
    expect(resolvePoolConfig({ PG_POOL_MAX: '10.5' }).max).toBe(10);
    expect(resolvePoolConfig({ PG_POOL_MAX: '-3' }).max).toBe(10);
  });

  it('keeps keepAlive and allowExitOnIdle constant regardless of env', () => {
    const cfg = resolvePoolConfig({ PG_POOL_MAX: '25' });
    expect(cfg.keepAlive).toBe(true);
    expect(cfg.allowExitOnIdle).toBe(false);
  });

  it('reads the timeout knobs from env', () => {
    const cfg = resolvePoolConfig({
      PG_POOL_CONNECTION_TIMEOUT_MS: '5000',
      PG_POOL_IDLE_TIMEOUT_MS: '15000',
    });
    expect(cfg.connectionTimeoutMillis).toBe(5000);
    expect(cfg.idleTimeoutMillis).toBe(15000);
  });
});
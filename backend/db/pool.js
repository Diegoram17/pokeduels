import pg from 'pg';

const { Pool } = pg;

// Shared pool for the whole backend. DATABASE_URL comes from the environment
// (Neon convention in this repo — see .env.example). Tests are gated on
// DATABASE_URL, so a missing value surfaces at query time, not import time.

/**
 * Coerces a raw env value to a positive integer, falling back to `fallback`
 * for anything else: Number(undefined)=NaN, Number('')=0, Number('abc')=NaN,
 * Number('10.5')=10.5 (non-integer), Number('-3')=-3 (non-positive).
 */
function toPositiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Pure pool-options resolver (design: derive options ONLY from `env`, never
 * from process state). Tunables target the Neon direct endpoint: max below
 * Neon's connection cap, ~10s fail-fast connect on cold computes, ~30s idle
 * recycle well under Neon's 300s auto-suspend, keepAlive to detect NAT-killed
 * sockets, and allowExitOnIdle:false for a long-lived server.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('pg').PoolConfig}
 */
export function resolvePoolConfig(env = process.env) {
  return {
    connectionString: env.DATABASE_URL,
    max: toPositiveInt(env.PG_POOL_MAX, 10),
    connectionTimeoutMillis: toPositiveInt(env.PG_POOL_CONNECTION_TIMEOUT_MS, 10_000),
    idleTimeoutMillis: toPositiveInt(env.PG_POOL_IDLE_TIMEOUT_MS, 30_000),
    keepAlive: true,
    allowExitOnIdle: false,
  };
}

export const pool = new Pool(resolvePoolConfig());

/** Graceful-shutdown seam: drains and ends the shared pool (phase-3 F7 target). */
export const closePool = () => pool.end();
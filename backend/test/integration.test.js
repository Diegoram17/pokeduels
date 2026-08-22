import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * End-to-end schema + seed integration test against a real Postgres/Neon
 * branch. Gated on DATABASE_URL: without it the whole suite skips — there is
 * no backend CI yet, so this is meant for local runs with a Neon connection
 * string exported.
 *
 *   PowerShell:  $env:DATABASE_URL = "postgres://..."
 *   bash/zsh:    export DATABASE_URL="postgres://..."
 *   Then:        cd backend && npm run test:run
 */
const { Pool } = pg;

const BACKEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATE = 'node node_modules/node-pg-migrate/bin/node-pg-migrate.js';
const hasDatabase = Boolean(process.env.DATABASE_URL);

function run(cmd) {
  return execSync(cmd, { cwd: BACKEND_DIR, env: { ...process.env }, stdio: 'pipe' });
}

describe.skipIf(!hasDatabase)('database schema + seed integration (requires DATABASE_URL)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('migrates up, seeds 18/54/324 with full 18x18 coverage, then migrates down to empty', () => {
    run(`${MIGRATE} up`);
    run('node seed/index.js');

    const n = (sql) => pool.query(sql).then((r) => r.rows[0].n);

    return Promise.all([
      n('SELECT COUNT(*)::int AS n FROM types'),
      n('SELECT COUNT(*)::int AS n FROM pokemons'),
      n('SELECT COUNT(*)::int AS n FROM type_effectiveness'),
      n('SELECT COUNT(DISTINCT attacking_type)::int AS n FROM type_effectiveness'),
      n('SELECT COUNT(DISTINCT defending_type)::int AS n FROM type_effectiveness'),
    ]).then(([types, pokemons, effectiveness, attacking, defending]) => {
      expect(types).toBe(18);
      expect(pokemons).toBe(54);
      expect(effectiveness).toBe(324);
      expect(attacking).toBe(18);
      expect(defending).toBe(18);
    });
  });

  it('seeds idempotently: a second run keeps 54 pokemons and 324 rows', () => {
    run('node seed/index.js');
    run('node seed/index.js');

    const n = (sql) => pool.query(sql).then((r) => r.rows[0].n);

    return Promise.all([
      n('SELECT COUNT(*)::int AS n FROM pokemons'),
      n('SELECT COUNT(*)::int AS n FROM type_effectiveness'),
    ]).then(([pokemons, effectiveness]) => {
      expect(pokemons).toBe(54);
      expect(effectiveness).toBe(324);
    });
  });

  it('reverts every table on migrate down', () => {
    run(`${MIGRATE} down`);

    return pool
      .query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name <> 'pgmigrations'`,
      )
      .then((result) => {
        expect(result.rows).toHaveLength(0);
      });
  });
});
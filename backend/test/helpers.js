import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATE = 'node node_modules/node-pg-migrate/bin/node-pg-migrate.js';
export const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * Runs a CLI command synchronously from the backend dir, inheriting the
 * current environment. Uses spawnSync with stdio:'inherit' (not execSync with
 * piped stdio): piped stdio deadlocks inside vitest's fork workers on Windows
 * when the spawned child is another node process (e.g. node-pg-migrate) -- the
 * worker's inherited IPC handle keeps the pipe open and execSync never
 * returns. stdio:'inherit' attaches the child directly to the worker's fds.
 * The command's exit code is the contract: non-zero throws.
 * (Same helper as test/integration.test.js, extracted for reuse.)
 */
export function run(cmd) {
  const result = spawnSync(cmd, {
    cwd: BACKEND_DIR,
    env: { ...process.env },
    stdio: 'inherit',
    shell: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${cmd}`);
  }
}

/**
 * Self-provisions the test database for a file: applies migrations and seeds
 * the catalog when the expected rows are missing. Idempotent and fast when
 * data is already present (integration.test.js may have run migrate down,
 * leaving the schema empty -- this rebuilds it).
 */
export async function ensureSchemaAndSeed(pool) {
  run(`${MIGRATE} up`);
  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM pokemons) AS pokemons,
            (SELECT COUNT(*)::int FROM type_effectiveness) AS effectiveness,
            (SELECT COUNT(*)::int FROM pokemons WHERE back_sprite_url IS NULL) AS null_backs`,
  );
  const { pokemons, effectiveness, null_backs } = rows[0];
  // Counts alone are not enough: migrate up recreates the back_sprite_url
  // column NULL (after a partial migrate down), so also require it populated.
  if (pokemons !== 54 || effectiveness !== 324 || null_backs > 0) {
    run('node seed/index.js');
  }
}

export const SEED_TIMEOUT = 600000;
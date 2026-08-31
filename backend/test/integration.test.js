import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertDestructiveDbAllowed } from './helpers.js';

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

/**
 * Runs a CLI command synchronously from the backend dir, inheriting the
 * current environment. Uses spawnSync with stdio:'inherit' (not execSync with
 * piped stdio): piped stdio deadlocks inside vitest's fork workers on Windows
 * when the spawned child is another node process (e.g. node-pg-migrate) -- the
 * worker's inherited IPC handle keeps the pipe open and execSync never
 * returns. stdio:'inherit' attaches the child directly to the worker's fds.
 * The command's exit code is the contract: non-zero throws.
 */
function run(cmd) {
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

describe.skipIf(!hasDatabase)('database schema + seed integration (requires DATABASE_URL)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // This suite is destructive by design (migrate down 0 wipes the schema and
  // re-seed rebuilds it). The guard refuses to run unless the target is a
  // throwaway DB (ALLOW_DESTRUCTIVE_DB_TESTS=1) — spec R7c, ADR-0012.
  beforeAll(() => {
    assertDestructiveDbAllowed();
  });

  afterAll(async () => {
    await pool.end();
  });

  // The run()-based tests are slow by design: each `node seed/index.js`
  // invocation takes ~70-120s (324-row upsert over Neon TLS, pre-existing
  // seed-script characteristic), so the vitest default 5s timeout is far too
  // tight. 600s of headroom covers migrate up + seed + migrate down.
  const SLOW_TEST_TIMEOUT = 600000;

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
  }, SLOW_TEST_TIMEOUT);

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
  }, SLOW_TEST_TIMEOUT);

  // Constraint-rejection scenarios (spec obs #127, scenarios #1-#15). These
  // can only be proven against a real Postgres instance -- CHECK/FK/UNIQUE
  // enforcement does not exist at the application layer. They run after the
  // schema+seed test above (types/pokemons/type_effectiveness already
  // populated) and before the migrate-down test (schema still present).

  const pokemonIdByName = async (name) => {
    const result = await pool.query('SELECT id FROM pokemons WHERE name = $1', [name]);
    return result.rows[0].id;
  };

  it('players: two players named "Ash" in different rooms both insert successfully with distinct session_token', async () => {
    const a = await pool.query(`INSERT INTO players (nickname) VALUES ('Ash') RETURNING session_token`);
    const b = await pool.query(`INSERT INTO players (nickname) VALUES ('Ash') RETURNING session_token`);
    expect(a.rows[0].session_token).not.toBe(b.rows[0].session_token);
  });

  it('types: a pokemons row referencing an unknown type is rejected on the foreign key', async () => {
    await expect(
      pool.query(
        `INSERT INTO pokemons (name, type, pokeapi_id) VALUES ($1, 'cosmic', $2)`,
        ['ConstraintTestCosmic', 999901],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('pokemons: a second row named "Pikachu" is rejected on the unique constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO pokemons (name, type, pokeapi_id) VALUES ('Pikachu', 'electric', $1)`,
        [999902],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('type effectiveness: multiplier = 1.5 is rejected on the CHECK constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO type_effectiveness (attacking_type, defending_type, multiplier)
         VALUES ('fire', 'water', 1.5)
         ON CONFLICT (attacking_type, defending_type) DO NOTHING`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rooms: updating status to "cancelled" is rejected on the CHECK constraint', async () => {
    const room = await pool.query(`INSERT INTO rooms (code, max_players) VALUES ('RMSTAT01', 2) RETURNING id`);
    await expect(
      pool.query(`UPDATE rooms SET status = 'cancelled' WHERE id = $1`, [room.rows[0].id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rooms: max_players = 3 is rejected on the CHECK constraint', async () => {
    await expect(
      pool.query(`INSERT INTO rooms (code, max_players) VALUES ('RMCAP01', 3)`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('room players: two different players joining as "Ash" in the same room are rejected on the (room_id, nickname) unique constraint', async () => {
    const room = await pool.query(`INSERT INTO rooms (code, max_players) VALUES ('RMPLYR01', 2) RETURNING id`);
    const playerA = await pool.query(`INSERT INTO players (nickname) VALUES ('Ash') RETURNING id`);
    const playerB = await pool.query(`INSERT INTO players (nickname) VALUES ('Ash') RETURNING id`);

    await pool.query(
      `INSERT INTO room_players (room_id, player_id, nickname) VALUES ($1, $2, 'Ash')`,
      [room.rows[0].id, playerA.rows[0].id],
    );
    await expect(
      pool.query(
        `INSERT INTO room_players (room_id, player_id, nickname) VALUES ($1, $2, 'Ash')`,
        [room.rows[0].id, playerB.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('team selections: slot = 7 is rejected on the CHECK constraint', async () => {
    const room = await pool.query(`INSERT INTO rooms (code, max_players) VALUES ('RMSLOT01', 2) RETURNING id`);
    const player = await pool.query(`INSERT INTO players (nickname) VALUES ('Slot Tester') RETURNING id`);
    const pikachuId = await pokemonIdByName('Pikachu');

    await expect(
      pool.query(
        `INSERT INTO team_selections (room_id, player_id, pokemon_id, slot) VALUES ($1, $2, $3, 7)`,
        [room.rows[0].id, player.rows[0].id, pikachuId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('starter exclusivity: a second player selecting Pikachu as starter in the same room is rejected on uq_starter_por_sala', async () => {
    const room = await pool.query(`INSERT INTO rooms (code, max_players) VALUES ('RMSTAR01', 2) RETURNING id`);
    const playerA = await pool.query(`INSERT INTO players (nickname) VALUES ('Starter A') RETURNING id`);
    const playerB = await pool.query(`INSERT INTO players (nickname) VALUES ('Starter B') RETURNING id`);
    const pikachuId = await pokemonIdByName('Pikachu');

    await pool.query(
      `INSERT INTO team_selections (room_id, player_id, pokemon_id, is_starter, slot) VALUES ($1, $2, $3, TRUE, 1)`,
      [room.rows[0].id, playerA.rows[0].id, pikachuId],
    );
    await expect(
      pool.query(
        `INSERT INTO team_selections (room_id, player_id, pokemon_id, is_starter, slot) VALUES ($1, $2, $3, TRUE, 1)`,
        [room.rows[0].id, playerB.rows[0].id, pikachuId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('duels: round = "octavos" is rejected on the CHECK constraint', async () => {
    await expect(
      pool.query(`INSERT INTO duels (round) VALUES ('octavos')`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('duels: setting end_reason = "timeout" is rejected on the CHECK constraint', async () => {
    const duel = await pool.query(`INSERT INTO duels (round) VALUES ('unica') RETURNING id`);
    await expect(
      pool.query(`UPDATE duels SET end_reason = 'timeout' WHERE id = $1`, [duel.rows[0].id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('duel pokemon state: current_hp = 120 is rejected on the CHECK constraint', async () => {
    await expect(
      pool.query(`INSERT INTO duel_pokemon_state (current_hp) VALUES (120)`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('duel pokemon state: pp_move_1 = 5 is rejected on the CHECK constraint', async () => {
    await expect(
      pool.query(`INSERT INTO duel_pokemon_state (pp_move_1) VALUES (5)`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('moves: action_type = "flee" is rejected on the CHECK constraint', async () => {
    await expect(
      pool.query(`INSERT INTO moves (turn_number, action_type) VALUES (1, 'flee')`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('moves: action_type = "attack" with move_index = 5 is rejected on the CHECK constraint', async () => {
    await expect(
      pool.query(`INSERT INTO moves (turn_number, action_type, move_index) VALUES (1, 'attack', 5)`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  // Regression guard for chk_move_index_required_for_attack (db-schema-seed
  // migration-fix change): an attack MUST carry its move_index (1..4). A NULL
  // move_index passes the column CHECK (NULL evaluates unknown) but violates
  // the table-level CHECK.
  it('moves: action_type = "attack" with move_index = NULL is rejected on the move_index-required CHECK constraint', async () => {
    await expect(
      pool.query(`INSERT INTO moves (turn_number, action_type, move_index) VALUES (1, 'attack', NULL)`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('reverts every table on migrate down', async () => {
    // Other integration files (e.g. tournamentLifecycle) can run before this
    // one and leave `duels` rows with end_reason='walkover'. The 0003 down
    // migration restores a CHECK that does NOT allow 'walkover', so the revert
    // would fail on those rows. Clear every data table first so `down 0`
    // reverts the full chain cleanly (the tables themselves are dropped by
    // 0001's down, so TRUNCATE here only removes rows, never schema).
    await pool.query(
      'TRUNCATE TABLE moves, duel_pokemon_state, duels, team_selections, room_players, rooms, players, pokemons, type_effectiveness, types RESTART IDENTITY CASCADE',
    );

    // node-pg-migrate v7's bare `down` defaults its count to 1 (see
    // getMigrationsToRun: `const { count: count2 = 1 } = options`), so it only
    // reverts the LAST applied migration and leaves 0001's 10 tables standing.
    // Passing an explicit count of `0` reverts the full chain to empty.
    run(`${MIGRATE} down 0`);

    return pool
      .query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name <> 'pgmigrations'`,
      )
      .then((result) => {
        expect(result.rows).toHaveLength(0);
      });
  }, SLOW_TEST_TIMEOUT);
});
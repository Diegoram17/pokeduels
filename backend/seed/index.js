#!/usr/bin/env node
/**
 * seed/index.js — loads the canonical root seed-data.json into the database.
 *
 * Pipeline (single transaction, so a failed run never leaves partial data):
 *   1. Upsert the 18 canonical types (ON CONFLICT (name) DO NOTHING).
 *   2. Read root seed-data.json, merge starters + catalog, validate every
 *      type against the canonical 18 — drift aborts BEFORE any write.
 *   3. Upsert pokemons by name (ON CONFLICT (name) DO UPDATE).
 *   4. Prune pokemons whose name is no longer in the seed data (e.g. a
 *      catalog swap that drops entries), deleting their historical
 *      dependents first (moves, duel_pokemon_state, team_selections) since
 *      none of those FKs cascade — upsert alone never removes stale rows.
 *   5. Expand the 120 sparse effectiveness rows to the full 324 ordered pairs
 *      (curated multiplier wins, otherwise 1.0) and upsert each.
 *   6. Assert exact post-seed counts (18 / 150 / 324 and 18x18 coverage) —
 *      any mismatch rolls back and exits non-zero.
 *
 * Requires DATABASE_URL (Neon). Idempotent: safe to rerun without a schema
 * rollback. `npm run seed` triggers the preseed hook first, which syncs the
 * frontend copy of seed-data.json.
 */
import pg from 'pg';
import { CANONICAL_TYPES } from './canonicalTypes.js';
import { readSeedData, mergeCatalog } from './loadCatalog.js';
import { expandEffectiveness } from './expandEffectiveness.js';
import { assertSeedCounts } from './assertions.js';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('seed: DATABASE_URL is not set — point it at a Neon branch and retry.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const type of CANONICAL_TYPES) {
      await client.query(
        'INSERT INTO types (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [type],
      );
    }

    // Validates every type against the canonical 18 and rejects duplicate
    // names BEFORE any write lands — unknown-type drift aborts the seed.
    const data = readSeedData();
    const pokemons = mergeCatalog(data);

    for (const p of pokemons) {
      await client.query(
        `INSERT INTO pokemons (name, type, pokeapi_id, sprite_url, back_sprite_url, is_starter)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO UPDATE SET
           type = EXCLUDED.type,
           pokeapi_id = EXCLUDED.pokeapi_id,
           sprite_url = EXCLUDED.sprite_url,
           back_sprite_url = EXCLUDED.back_sprite_url,
           is_starter = EXCLUDED.is_starter`,
        [p.name, p.type, p.pokeapi_id, p.sprite_url ?? null, p.back_sprite_url ?? null, p.is_starter ?? false],
      );
    }

    // Upsert never removes rows: a pokemon dropped from seed-data.json (e.g.
    // this catalog swap to Gen-1-only) would otherwise linger forever. Prune
    // it and its historical dependents in FK-safe order — none of the
    // pokemon_id FKs cascade, so leaving this out would either fail the
    // count assertion below or (if loosened) silently keep stale entries
    // selectable in the live catalog.
    const keepNames = pokemons.map((p) => p.name);
    const { rows: staleRows } = await client.query(
      'SELECT id FROM pokemons WHERE NOT (name = ANY($1::text[]))',
      [keepNames],
    );
    const staleIds = staleRows.map((r) => r.id);
    if (staleIds.length > 0) {
      await client.query(
        'DELETE FROM moves WHERE pokemon_id = ANY($1) OR target_pokemon_id = ANY($1)',
        [staleIds],
      );
      await client.query('DELETE FROM duel_pokemon_state WHERE pokemon_id = ANY($1)', [staleIds]);
      await client.query('DELETE FROM team_selections WHERE pokemon_id = ANY($1)', [staleIds]);
      await client.query('DELETE FROM pokemons WHERE id = ANY($1)', [staleIds]);
      console.log(`seed: pruned ${staleIds.length} pokemon(s) no longer in seed-data.json`);
    }

    const rows = expandEffectiveness(data.type_effectiveness ?? [], CANONICAL_TYPES);
    for (const row of rows) {
      await client.query(
        `INSERT INTO type_effectiveness (attacking_type, defending_type, multiplier)
         VALUES ($1, $2, $3)
         ON CONFLICT (attacking_type, defending_type) DO UPDATE SET multiplier = EXCLUDED.multiplier`,
        [row.attacking_type, row.defending_type, row.multiplier],
      );
    }

    const [typesResult, pokemonsResult, effectivenessResult, attackingResult, defendingResult] =
      await Promise.all([
        client.query('SELECT COUNT(*)::int AS n FROM types'),
        client.query('SELECT COUNT(*)::int AS n FROM pokemons'),
        client.query('SELECT COUNT(*)::int AS n FROM type_effectiveness'),
        client.query('SELECT COUNT(DISTINCT attacking_type)::int AS n FROM type_effectiveness'),
        client.query('SELECT COUNT(DISTINCT defending_type)::int AS n FROM type_effectiveness'),
      ]);

    assertSeedCounts({
      types: typesResult.rows[0].n,
      pokemons: pokemonsResult.rows[0].n,
      effectiveness: effectivenessResult.rows[0].n,
      attackingTypes: attackingResult.rows[0].n,
      defendingTypes: defendingResult.rows[0].n,
    });

    await client.query('COMMIT');
    console.log(`seed: ok — 18 types, ${pokemons.length} pokemons, ${rows.length} effectiveness rows`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`seed: FAILED — ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
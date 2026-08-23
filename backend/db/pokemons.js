import { pool } from './pool.js';

/**
 * Thin read-only queries over the seeded catalog. Raw rows: snake_case keys
 * matching the spec contract for /api/pokemons.
 */
export async function listPokemons() {
  const { rows } = await pool.query(
    `SELECT id, name, type, pokeapi_id, sprite_url, back_sprite_url, is_starter
     FROM pokemons
     ORDER BY id`,
  );
  return rows;
}

/**
 * Full 18x18 ordered effectiveness matrix. attacking_type/defending_type are
 * aliased to the spec's camelCase keys; multiplier stays the raw NUMERIC(2,1)
 * value ("2.0" | "1.0" | "0.5").
 */
export async function listTypeEffectiveness() {
  const { rows } = await pool.query(
    `SELECT attacking_type AS "attackingType",
            defending_type AS "defendingType",
            multiplier
     FROM type_effectiveness`,
  );
  return rows;
}
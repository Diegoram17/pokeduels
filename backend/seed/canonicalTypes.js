/**
 * The 18 canonical Pokémon types — the seed's source of truth.
 * Any type referenced by seed-data.json must belong to this list;
 * drift is a hard error, never a silent default.
 */
export const CANONICAL_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark',
  'steel', 'fairy',
];

/**
 * Validates a single type against the canonical 18.
 * Throws loudly on unknown types so seed drift aborts before any write.
 *
 * @param {string} type
 * @returns {string} the validated type
 */
export function validateType(type) {
  if (!CANONICAL_TYPES.includes(type)) {
    throw new Error(`Unknown pokemon type "${type}" — not in the canonical 18 types`);
  }
  return type;
}
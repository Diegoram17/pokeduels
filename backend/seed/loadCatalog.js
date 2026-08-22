import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateType } from './canonicalTypes.js';

/** Repo-root canonical seed file, resolved from this module's location. */
export const DEFAULT_SEED_DATA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'seed-data.json',
);

/**
 * Merges the starters and catalog arrays into one ordered list, validating
 * every type against the canonical 18 and rejecting duplicate names.
 * Validation happens BEFORE any DB write so drift aborts the seed cleanly.
 *
 * @param {{ starters?: Array, catalog?: Array }} data parsed seed-data.json
 * @returns {Array} merged pokemon entries (starters first, then catalog)
 */
export function mergeCatalog(data) {
  const merged = [...(data.starters ?? []), ...(data.catalog ?? [])];

  const seen = new Set();
  for (const pokemon of merged) {
    validateType(pokemon.type);
    if (seen.has(pokemon.name)) {
      throw new Error(`Duplicate pokemon name "${pokemon.name}" in seed data`);
    }
    seen.add(pokemon.name);
  }
  return merged;
}

/**
 * Reads and merges the canonical seed file (root seed-data.json by default).
 *
 * @param {string} [filePath] path to seed-data.json
 * @returns {Array} merged pokemon entries
 */
export function loadCatalogFromFile(filePath = DEFAULT_SEED_DATA_PATH) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  return mergeCatalog(data);
}
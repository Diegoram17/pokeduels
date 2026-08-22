import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Proves spec scenario "Sync produces an identical copy" (obs #127): root
 * seed-data.json is the single source of truth and frontend/public's copy
 * must stay byte-identical to it. Static check only -- does not exercise
 * scripts/sync-seed-data.mjs itself (a 5-line dependency-free copy script),
 * just the invariant it is responsible for maintaining.
 */
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_SEED_DATA = join(ROOT_DIR, 'seed-data.json');
const FRONTEND_SEED_DATA = join(ROOT_DIR, 'frontend', 'public', 'seed-data.json');

describe('seed-data.json single source of truth', () => {
  it('frontend/public/seed-data.json is byte-identical to the root seed-data.json', () => {
    const root = readFileSync(ROOT_SEED_DATA);
    const frontend = readFileSync(FRONTEND_SEED_DATA);
    expect(frontend.equals(root)).toBe(true);
  });
});

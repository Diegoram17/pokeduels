#!/usr/bin/env node
/**
 * sync-seed-data.mjs
 *
 * Keeps `frontend/public/seed-data.json` a byte-identical generated copy of the
 * canonical root `seed-data.json`. Run manually after hand-editing the root
 * file before committing, or automatically via backend's `preseed` npm hook
 * (fires before every `npm run seed`).
 *
 * No dependencies; `.mjs` forces ESM without a root package.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT_DIR, 'seed-data.json');
const TARGET = join(ROOT_DIR, 'frontend', 'public', 'seed-data.json');

const sourceBytes = readFileSync(SOURCE);
writeFileSync(TARGET, sourceBytes);
console.log(`sync-seed-data: ${SOURCE} -> ${TARGET} (${sourceBytes.length} bytes)`);
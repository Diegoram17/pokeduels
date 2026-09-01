import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { listPokemons, listTypeEffectiveness } from '../db/pokemons.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';

const MULTIPLIERS = new Set(['2.0', '1.0', '0.5']);

describe.skipIf(!hasDatabase)('catalog API (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
  }, SEED_TIMEOUT);

  afterAll(async () => {
    await pool.end();
  });

  describe('db layer: listPokemons / listTypeEffectiveness', () => {
    it('listPokemons returns the full 150-entry catalog with 4 starters', async () => {
      const pokemons = await listPokemons();
      expect(pokemons).toHaveLength(150);
      expect(pokemons.filter((p) => p.is_starter)).toHaveLength(4);
    });

    it('listTypeEffectiveness returns 324 rows with valid multipliers', async () => {
      const rows = await listTypeEffectiveness();
      expect(rows).toHaveLength(324);
      for (const row of rows) {
        expect(MULTIPLIERS.has(row.multiplier)).toBe(true);
      }
      const attackingTypes = new Set(rows.map((r) => r.attackingType));
      expect(attackingTypes.size).toBe(18);
    });
  });

  describe('GET /api/pokemons', () => {
    it('returns 200 with exactly 150 entries, 4 of which are starters', async () => {
      const app = createApp();
      const res = await request(app).get('/api/pokemons');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(150);
      expect(res.body.filter((p) => p.is_starter === true)).toHaveLength(4);
    });

    it('exposes the spec fields: name, type, sprite_url, back_sprite_url, is_starter', async () => {
      const app = createApp();
      const res = await request(app).get('/api/pokemons');

      const pikachu = res.body.find((p) => p.name === 'Pikachu');
      expect(pikachu).toBeDefined();
      expect(pikachu.type).toBe('electric');
      expect(typeof pikachu.sprite_url).toBe('string');
      expect(typeof pikachu.back_sprite_url).toBe('string');
      expect(pikachu.is_starter).toBe(true);
    });
  });

  describe('GET /api/type-effectiveness', () => {
    it('returns 200 with exactly 324 flat entries, each multiplier 2.0/1.0/0.5', async () => {
      const app = createApp();
      const res = await request(app).get('/api/type-effectiveness');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(324);
      for (const entry of res.body) {
        expect(entry).toHaveProperty('attackingType');
        expect(entry).toHaveProperty('defendingType');
        expect(MULTIPLIERS.has(entry.multiplier)).toBe(true);
      }
    });

    it('covers the full 18x18 ordered matrix', async () => {
      const app = createApp();
      const res = await request(app).get('/api/type-effectiveness');

      const attacking = new Set(res.body.map((e) => e.attackingType));
      const defending = new Set(res.body.map((e) => e.defendingType));
      expect(attacking.size).toBe(18);
      expect(defending.size).toBe(18);
      const pairs = new Set(res.body.map((e) => `${e.attackingType}>${e.defendingType}`));
      expect(pairs.size).toBe(324);
    });
  });

  describe('unknown routes', () => {
    it('returns 404 JSON for an unknown path', async () => {
      const app = createApp();
      const res = await request(app).get('/api/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.error).toBeTruthy();
    });
  });
});
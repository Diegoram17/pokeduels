import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { createPlayer, touchSession } from '../db/players.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe.skipIf(!hasDatabase)('session API (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
  }, SEED_TIMEOUT);

  afterAll(async () => {
    await pool.end();
  });

  describe('db layer: createPlayer / touchSession', () => {
    it('createPlayer inserts a row and returns id, nickname, sessionToken', async () => {
      const player = await createPlayer('Ash');
      expect(typeof player.id).toBe('number');
      expect(player.nickname).toBe('Ash');
      expect(player.sessionToken).toMatch(UUID_RE);
    });

    it('touchSession resolves a known token to the player', async () => {
      const player = await createPlayer('Misty');
      const touched = await touchSession(player.sessionToken);
      expect(touched.id).toBe(player.id);
      expect(touched.nickname).toBe('Misty');
    });

    it('touchSession returns undefined for an unknown token', async () => {
      const touched = await touchSession('00000000-0000-4000-8000-000000000000');
      expect(touched).toBeUndefined();
    });
  });

  describe('POST /api/session', () => {
    it('returns 201 with playerId and a UUID sessionToken for a valid nickname', async () => {
      const app = createApp();
      const res = await request(app).post('/api/session').send({ nickname: 'Brock' });

      expect(res.status).toBe(201);
      expect(typeof res.body.playerId).toBe('number');
      expect(res.body.sessionToken).toMatch(UUID_RE);

      const { rows } = await pool.query(
        'SELECT 1 FROM players WHERE id = $1 AND session_token = $2',
        [res.body.playerId, res.body.sessionToken],
      );
      expect(rows).toHaveLength(1);
    });

    it('rejects an empty nickname with 400 and creates no players row', async () => {
      const app = createApp();
      const before = await pool.query('SELECT COUNT(*)::int AS n FROM players');

      const res = await request(app).post('/api/session').send({ nickname: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
      const after = await pool.query('SELECT COUNT(*)::int AS n FROM players');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('rejects a 31-character nickname with 400 and creates no players row', async () => {
      const app = createApp();
      const longNickname = 'n'.repeat(31);
      const before = await pool.query('SELECT COUNT(*)::int AS n FROM players');

      const res = await request(app).post('/api/session').send({ nickname: longNickname });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
      const after = await pool.query('SELECT COUNT(*)::int AS n FROM players');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('returns 429 on the 11th request within the minute and inserts no row', async () => {
      const app = createApp();
      const nickname = 'RateLimitProbe';
      const before = await pool.query(
        'SELECT COUNT(*)::int AS n FROM players WHERE nickname = $1',
        [nickname],
      );

      for (let i = 0; i < 10; i += 1) {
        const res = await request(app).post('/api/session').send({ nickname });
        expect(res.status).toBe(201);
      }

      const eleventh = await request(app).post('/api/session').send({ nickname });
      expect(eleventh.status).toBe(429);

      const after = await pool.query(
        'SELECT COUNT(*)::int AS n FROM players WHERE nickname = $1',
        [nickname],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n + 10);
    });
  });
});
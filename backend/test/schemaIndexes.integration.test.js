import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../db/pool.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';

/**
 * DB-gated catalog check for migration 0005 (hot-predicate indexes). Matches
 * each index by (indexname, tablename) and, for the two partial indexes,
 * asserts the predicate is actually present in the index definition — a
 * non-partial index would fail the WHERE assertion.
 */
const EXPECTED_INDEXES = [
  { indexname: 'idx_duel_pokemon_state_duel_id', tablename: 'duel_pokemon_state', partial: false },
  { indexname: 'idx_moves_duel_id', tablename: 'moves', partial: false },
  { indexname: 'idx_duels_room_id', tablename: 'duels', partial: false },
  { indexname: 'idx_duels_player1_id', tablename: 'duels', partial: false },
  { indexname: 'idx_duels_player2_id', tablename: 'duels', partial: false },
  { indexname: 'idx_duels_active', tablename: 'duels', partial: true },
  { indexname: 'idx_rooms_waiting', tablename: 'rooms', partial: true },
];

describe.skipIf(!hasDatabase)('migration 0005 index catalog (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
  }, SEED_TIMEOUT);

  afterAll(async () => {
    await pool.end();
  });

  it('has all seven 0005 indexes with the expected table and predicate', async () => {
    const { rows } = await pool.query(
      `SELECT indexname, tablename, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'`,
    );
    const byName = new Map(rows.map((r) => [r.indexname, r]));

    for (const expected of EXPECTED_INDEXES) {
      const row = byName.get(expected.indexname);
      expect(row, `index ${expected.indexname} exists`).toBeTruthy();
      expect(row.tablename, `index ${expected.indexname} is on ${expected.tablename}`).toBe(
        expected.tablename,
      );
      if (expected.partial) {
        expect(
          row.indexdef,
          `index ${expected.indexname} carries a WHERE predicate`,
        ).toContain('WHERE');
      }
    }
  });
});
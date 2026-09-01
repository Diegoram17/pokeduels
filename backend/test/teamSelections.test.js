import { describe, it, expect, beforeEach, vi } from 'vitest';

// Design-authorized unit test: mock pool to exercise the pg error-code →
// WsError mapping without touching Neon (integration coverage lives in the
// PR 3 team.ws.test.js suite).
const { poolMock } = vi.hoisted(() => ({
  poolMock: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('../db/pool.js', () => ({ pool: poolMock }));

import { selectStarter, selectRoster } from '../db/teamSelections.js';

const ROOM_ID = 5;
const PLAYER_ID = 9;

function makeClientMock() {
  return { query: vi.fn(), release: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('selectStarter', () => {
  it('upserts the starter at slot 1 with is_starter TRUE (ON CONFLICT DO UPDATE) and returns the row', async () => {
    const row = { id: 1, room_id: ROOM_ID, player_id: PLAYER_ID, pokemon_id: 25, is_starter: true, slot: 1 };
    poolMock.query.mockResolvedValue({ rows: [row] });

    const result = await selectStarter(ROOM_ID, PLAYER_ID, 25);

    expect(result).toEqual(row);
    const [sql, args] = poolMock.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE');
    expect(sql).toContain('slot');
    expect(args).toEqual([ROOM_ID, PLAYER_ID, 25, 1]);
  });

  it('re-selecting the same starter resolves idempotently (the upsert never rejects "already_selected")', async () => {
    const row = { id: 1, room_id: ROOM_ID, player_id: PLAYER_ID, pokemon_id: 25, is_starter: true, slot: 1 };
    poolMock.query.mockResolvedValue({ rows: [row] });

    await expect(selectStarter(ROOM_ID, PLAYER_ID, 25)).resolves.toEqual(row);
    await expect(selectStarter(ROOM_ID, PLAYER_ID, 25)).resolves.toEqual(row);
  });

  it('maps 23505 on uq_starter_por_sala to starter_rejected "taken"', async () => {
    poolMock.query.mockRejectedValue({ code: '23505', constraint: 'uq_starter_por_sala' });

    await expect(selectStarter(ROOM_ID, PLAYER_ID, 25)).rejects.toMatchObject({
      name: 'WsError',
      event: 'team:starter_rejected',
      payload: { pokemonId: 25, reason: 'taken' },
    });
  });

  it('maps an unexpected 23505 (any other unique constraint) to starter_rejected "already_selected"', async () => {
    poolMock.query.mockRejectedValue({ code: '23505', constraint: 'team_selections_some_other_key' });

    await expect(selectStarter(ROOM_ID, PLAYER_ID, 25)).rejects.toMatchObject({
      event: 'team:starter_rejected',
      payload: { pokemonId: 25, reason: 'already_selected' },
    });
  });

  it('maps 23503 FK violation to roster_rejected "not_in_catalog"', async () => {
    poolMock.query.mockRejectedValue({ code: '23503' });

    await expect(selectStarter(ROOM_ID, PLAYER_ID, 999)).rejects.toMatchObject({
      event: 'team:roster_rejected',
      payload: { reason: 'not_in_catalog' },
    });
  });

  it('rethrows errors that are not pg constraint codes', async () => {
    const err = new Error('db down');
    poolMock.query.mockRejectedValue(err);

    await expect(selectStarter(ROOM_ID, PLAYER_ID, 25)).rejects.toBe(err);
  });
});

describe('selectRoster', () => {
  it('rejects a payload that is not exactly 5 pokemon ids without touching the DB', async () => {
    await expect(selectRoster(ROOM_ID, PLAYER_ID, [1, 2, 3])).rejects.toMatchObject({
      event: 'team:roster_rejected',
      payload: { reason: 'invalid_count' },
    });
    expect(poolMock.connect).not.toHaveBeenCalled();
  });

  it('rejects duplicate ids in the payload without touching the DB', async () => {
    await expect(selectRoster(ROOM_ID, PLAYER_ID, [1, 2, 3, 4, 1])).rejects.toMatchObject({
      event: 'team:roster_rejected',
      payload: { reason: 'duplicate' },
    });
    expect(poolMock.connect).not.toHaveBeenCalled();
  });

  it('clears the player\'s previous roster rows, then inserts 5 fresh rows at slots 2..6 inside a transaction', async () => {
    const client = makeClientMock();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // DELETE previous roster rows
      .mockResolvedValueOnce({ rows: [{ id: 1, slot: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, slot: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3, slot: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 4, slot: 5 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, slot: 6 }] })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    poolMock.connect.mockResolvedValue(client);

    const result = await selectRoster(ROOM_ID, PLAYER_ID, [25, 26, 27, 28, 29]);

    expect(result).toHaveLength(5);
    expect(result.map((r) => r.slot)).toEqual([2, 3, 4, 5, 6]);
    expect(poolMock.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);

    const sqls = client.query.mock.calls.map(([sql]) => sql);
    const deleteIdx = sqls.findIndex(
      (sql) => sql.includes('DELETE FROM team_selections') && sql.includes('is_starter = FALSE'),
    );
    const firstInsertIdx = sqls.findIndex((sql) => sql.includes('INSERT'));
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeLessThan(firstInsertIdx);
    const deleteCall = client.query.mock.calls[deleteIdx];
    expect(deleteCall[1]).toEqual([ROOM_ID, PLAYER_ID]);

    // Each insert carries (room_id, player_id, pokemon_id, slot) args.
    const insertCalls = client.query.mock.calls.filter(([sql]) => sql.includes('INSERT'));
    expect(insertCalls).toHaveLength(5);
    expect(insertCalls[0][1]).toEqual([ROOM_ID, PLAYER_ID, 25, 2]);
    expect(insertCalls[4][1]).toEqual([ROOM_ID, PLAYER_ID, 29, 6]);
  });

  it('maps 23505 during insert to roster_rejected "duplicate" and rolls back', async () => {
    const client = makeClientMock();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // DELETE previous roster rows
      .mockRejectedValueOnce({ code: '23505', constraint: 'team_selections_room_id_player_id_pokemon_id_key' })
      .mockResolvedValue({ rows: [] }); // default: any later call (ROLLBACK)
    poolMock.connect.mockResolvedValue(client);

    await expect(selectRoster(ROOM_ID, PLAYER_ID, [25, 26, 27, 28, 29])).rejects.toMatchObject({
      event: 'team:roster_rejected',
      payload: { reason: 'duplicate' },
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('maps 23503 FK violation during insert to roster_rejected "not_in_catalog" and rolls back', async () => {
    const client = makeClientMock();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // DELETE previous roster rows
      .mockRejectedValueOnce({ code: '23503' })
      .mockResolvedValue({ rows: [] }); // default: any later call (ROLLBACK)
    poolMock.connect.mockResolvedValue(client);

    await expect(selectRoster(ROOM_ID, PLAYER_ID, [25, 26, 27, 28, 999])).rejects.toMatchObject({
      event: 'team:roster_rejected',
      payload: { reason: 'not_in_catalog' },
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

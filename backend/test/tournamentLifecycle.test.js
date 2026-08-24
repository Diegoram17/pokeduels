import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit tests for the post-duel tournament/rematch lifecycle (item #7, PR 1).
// Only the 1v1 rematch branch is implemented in this PR: a finished 1v1 duel
// MUST reset both seats' ready flags and MUST NOT close the room, write ranks,
// or emit any room/tournament event (spec: "Duel finish keeps the room open").
// The 4-player bracket branch is a PR-3 placeholder (no ready reset, no close).
//
// `pool` is mocked with a fake client that records every SQL string so the
// tests can prove the ready-reset ran and no close/rank/event side effects did.
vi.mock('../db/pool.js', () => ({
  pool: { connect: vi.fn() },
}));

import { pool } from '../db/pool.js';
import { advanceTournamentOrRematch } from '../ws/tournamentLifecycle.js';

/**
 * Builds a fake pg client whose SELECT of the room row returns `room`, and
 * which records every query string it runs. `release` is a no-op spy.
 */
function makeClient(room) {
  const queries = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      queries.push(sql);
      if (sql.includes('SELECT id, max_players, status FROM rooms')) {
        return { rows: [room] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, queries };
}

const io = { to: vi.fn(() => ({ emit: vi.fn() })) };

describe('advanceTournamentOrRematch — 1v1 rematch branch (item #7, PR 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets both seats ready to false for a 1v1 room and does NOT close or emit', async () => {
    const room = { id: 7, max_players: 2, status: 'in_progress' };
    const { client, queries } = makeClient(room);
    pool.connect.mockResolvedValue(client);

    await advanceTournamentOrRematch(io, 7, 9);

    // The room row is locked FOR UPDATE and the seats' ready flags are reset.
    expect(
      queries.some((sql) =>
        sql.includes('SELECT id, max_players, status FROM rooms') &&
        sql.includes('FOR UPDATE'),
      ),
    ).toBe(true);
    expect(
      queries.some((sql) =>
        sql.includes('UPDATE room_players') && sql.includes('ready = FALSE'),
      ),
    ).toBe(true);

    // Spec: no rank, no room close, no room:final_ranking / tournament event.
    expect(queries.some((sql) => sql.includes('final_rank'))).toBe(false);
    expect(queries.some((sql) => sql.includes("UPDATE rooms SET status = 'finished'"))).toBe(false);
    expect(io.to).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('does not emit any event or write ranks when the 1v1 room was reset (no side effects beyond ready reset)', async () => {
    const room = { id: 7, max_players: 2, status: 'in_progress' };
    const { client } = makeClient(room);
    pool.connect.mockResolvedValue(client);

    await advanceTournamentOrRematch(io, 7, 9);

    const updateSql = client.query.mock.calls
      .map((c) => c[0])
      .filter((sql) => sql.startsWith('UPDATE'));
    // Exactly one UPDATE: the ready reset. Nothing else mutates state.
    expect(updateSql).toHaveLength(1);
    expect(updateSql[0]).toContain('room_players');
    expect(updateSql[0]).toContain('ready = FALSE');
  });

  it('is a no-op (no ready reset, no emit) for an unknown room', async () => {
    const { client } = makeClient(null);
    pool.connect.mockResolvedValue(client);

    await advanceTournamentOrRematch(io, 999, 9);

    const updateSql = client.query.mock.calls
      .map((c) => c[0])
      .filter((sql) => sql.startsWith('UPDATE'));
    expect(updateSql).toHaveLength(0);
    expect(io.to).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('does NOT reset ready flags or close the room for a 4-player room (bracket branch is PR 3)', async () => {
    const room = { id: 7, max_players: 4, status: 'in_progress' };
    const { client } = makeClient(room);
    pool.connect.mockResolvedValue(client);

    // Must resolve without throwing (the 4p branch is a deferred placeholder).
    await advanceTournamentOrRematch(io, 7, 9);

    const updateSql = client.query.mock.calls
      .map((c) => c[0])
      .filter((sql) => sql.startsWith('UPDATE'));
    // No ready reset, no close, no rank writes for a 4p room in this PR.
    expect(updateSql).toHaveLength(0);
    expect(queriesHaveRoomClose(client)).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });
});

/** True if any query writes rooms.status='finished' (the close-and-rank path). */
function queriesHaveRoomClose(client) {
  return client.query.mock.calls
    .map((c) => c[0])
    .some((sql) => sql.includes("UPDATE rooms SET status = 'finished'"));
}

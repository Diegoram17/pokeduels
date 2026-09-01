import { describe, it, expect, beforeEach, vi } from 'vitest';

// Unit test for the bot team auto-selection guard. `pool` and the team-selection
// writers are mocked — this asserts the idempotency guard (skip when the bot
// already has a team) that lets advanceTournamentOrRematch re-seed bot seats
// after a match wipe without a double-insert (23505).
const { poolMock } = vi.hoisted(() => ({
  poolMock: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('../db/pool.js', () => ({ pool: poolMock }));
vi.mock('../db/teamSelections.js', () => ({
  selectStarter: vi.fn(async () => ({ id: 1 })),
  selectRoster: vi.fn(async () => [{ id: 2 }]),
}));
vi.mock('../repositories/duelRepository.js', () => ({
  getPlayerRoster: vi.fn(),
  activateLead: vi.fn(),
}));

import { autoSelectBotTeam } from '../ws/botManager.js';
import { selectStarter, selectRoster } from '../db/teamSelections.js';

const ROOM_ID = 5;
const BOT_ID = 88;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('autoSelectBotTeam', () => {
  it('is a no-op when the bot already has team_selections rows in the room (idempotent re-seed guard)', async () => {
    // First query is the guard: the bot already has a team.
    poolMock.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    await autoSelectBotTeam(ROOM_ID, BOT_ID);

    const [guardSql, guardArgs] = poolMock.query.mock.calls[0];
    expect(guardSql).toContain('team_selections');
    expect(guardArgs).toEqual([ROOM_ID, BOT_ID]);
    expect(poolMock.query).toHaveBeenCalledTimes(1);
    expect(selectStarter).not.toHaveBeenCalled();
    expect(selectRoster).not.toHaveBeenCalled();
  });

  it('picks a random starter + roster and marks the bot ready when it has no team yet', async () => {
    poolMock.query
      .mockResolvedValueOnce({ rows: [] }) // guard: no existing team
      .mockResolvedValueOnce({ rows: [] }) // taken starters in the room
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 4 }, { id: 7 }] }) // starter-eligible pokemon
      .mockResolvedValueOnce({
        rows: [{ id: 2 }, { id: 3 }, { id: 5 }, { id: 6 }, { id: 8 }, { id: 9 }],
      }) // roster pool
      .mockResolvedValueOnce({ rows: [] }); // UPDATE room_players ... ready = TRUE

    await autoSelectBotTeam(ROOM_ID, BOT_ID);

    expect(selectStarter).toHaveBeenCalledTimes(1);
    expect(selectStarter).toHaveBeenCalledWith(ROOM_ID, BOT_ID, expect.any(Number));
    expect(selectRoster).toHaveBeenCalledTimes(1);
    const [, , roster] = selectRoster.mock.calls[0];
    expect(roster).toHaveLength(5);

    const readySql = poolMock.query.mock.calls
      .map((c) => c[0])
      .find((sql) => sql.includes('UPDATE room_players') && sql.includes('ready = TRUE'));
    expect(readySql).toBeTruthy();
  });
});

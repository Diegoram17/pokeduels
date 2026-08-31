import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit tests for the post-duel tournament/rematch lifecycle (item #7, PR 1 +
// PR 3). The 1v1 rematch branch resets both seats' ready flags and does NOT
// close/rank/emit; the 4-player bracket branch (PR 3) drives the semifinal ->
// final/3rd-place -> full close-and-rank flow.
//
// `pool` is mocked with a fake client that records every SQL string and serves
// room/duels/room_players rows by SQL match, so tests can prove which branch
// ran and what it emitted without a real DB.
vi.mock('../db/pool.js', () => ({
  pool: { connect: vi.fn(), query: vi.fn() },
}));
vi.mock('../repositories/duelRepository.js', () => ({
  createDuelFromRoom: vi.fn(),
  findPendingBracketDuelForPlayer: vi.fn(),
  finishDuelByWalkover: vi.fn(),
}));
vi.mock('../ws/duelLifecycle.js', () => ({
  finalizeDuelSideEffects: vi.fn(),
}));

import { pool } from '../db/pool.js';
import {
  createDuelFromRoom,
  findPendingBracketDuelForPlayer,
  finishDuelByWalkover,
} from '../repositories/duelRepository.js';
import { finalizeDuelSideEffects } from '../ws/duelLifecycle.js';
import {
  advanceTournamentOrRematch,
  computeFourPlayerRanks,
} from '../ws/tournamentLifecycle.js';

/**
 * Builds a fake pg client whose SELECT of the room row returns `room`, whose
 * duels SELECT returns `duels`, whose room_players SELECT returns `seats`, and
 * which records every query string it runs. `release` is a no-op spy.
 */
function makeClient(room, { duels = [], seats = [] } = {}) {
  const queries = [];
  const client = {
    query: vi.fn(async (sql) => {
      queries.push(sql);
      if (sql.includes('SELECT id, max_players, status FROM rooms')) {
        return { rows: room ? [room] : [] };
      }
      if (sql.includes('FROM duels WHERE room_id')) {
        return { rows: duels };
      }
      if (sql.includes('FROM room_players')) {
        return { rows: seats };
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
});

describe('advanceTournamentOrRematch — 4-player bracket branch (item #7, PR 3)', () => {
  // Seats p1..p4. semiA = p1 vs p2 (winner p1); semiB = p3 vs p4 (winner p3).
  // final = p1 vs p3 (winner p1 -> ranks 1); thirdPlace = p2 vs p4 (winner p2
  // -> rank 3). Expected ranks: p1=1, p3=2, p2=3, p4=4.
  const bracketRoom = { id: 7, max_players: 4, status: 'in_progress' };
  const semiA = { id: 10, player1_id: 1, player2_id: 2, round: 'semifinal', status: 'finished', winner_id: 1 };
  const semiB = { id: 11, player1_id: 3, player2_id: 4, round: 'semifinal', status: 'finished', winner_id: 3 };
  const final = { id: 12, player1_id: 1, player2_id: 3, round: 'final', status: 'finished', winner_id: 1 };
  const thirdPlace = { id: 13, player1_id: 2, player2_id: 4, round: 'tercer_puesto', status: 'finished', winner_id: 2 };

  beforeEach(() => {
    vi.clearAllMocks();
    createDuelFromRoom.mockResolvedValue({ id: 99, status: 'pending' });
    findPendingBracketDuelForPlayer.mockResolvedValue(null);
    finishDuelByWalkover.mockResolvedValue({ applied: true });
    finalizeDuelSideEffects.mockResolvedValue(undefined);
  });

  it('emits tournament:awaiting_round while a semifinal is still pending (no finals, no close)', async () => {
    const pendingSemiB = { ...semiB, status: 'pending', winner_id: null };
    const { client } = makeClient(bracketRoom, { duels: [semiA, pendingSemiB] });
    pool.connect.mockResolvedValue(client);

    await advanceTournamentOrRematch(io, 7, 10);

    expect(io.to).toHaveBeenCalledWith('room:7');
    expect(io.to.mock.results[0].value.emit).toHaveBeenCalledWith('tournament:awaiting_round', { roomId: 7 });
    expect(createDuelFromRoom).not.toHaveBeenCalled();
    expect(queriesHaveRoomClose(client)).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('creates the final and third-place duels once both semifinals are done, and broadcasts the bracket', async () => {
    const { client } = makeClient(bracketRoom, { duels: [semiA, semiB] });
    pool.connect.mockResolvedValue(client);
    createDuelFromRoom
      .mockResolvedValueOnce({ id: 20, status: 'pending' }) // final
      .mockResolvedValueOnce({ id: 21, status: 'pending' }); // thirdPlace
    const phaseStore = { set: vi.fn(), get: vi.fn() };
    const roundState = { set: vi.fn(), get: vi.fn() };

    await advanceTournamentOrRematch(io, 7, 10, { phaseStore, roundState });

    // Final = the two semifinal winners; third-place = the two semifinal losers.
    expect(createDuelFromRoom).toHaveBeenNthCalledWith(1, 7, 1, 3, 'final');
    expect(createDuelFromRoom).toHaveBeenNthCalledWith(2, 7, 2, 4, 'tercer_puesto');

    // Both finals duels are registered for lead selection (A5 latent-bug gate
    // #2: the F1 phase guard rejects every bracket duel:select_lead when the
    // phase store has no entry, so the finals must be initialized exactly like
    // the semifinals and the 1v1 path).
    expect(phaseStore.set).toHaveBeenCalledWith(20, 'lead_selection');
    expect(phaseStore.set).toHaveBeenCalledWith(21, 'lead_selection');
    expect(roundState.set).toHaveBeenCalledWith(20, 'AWAITING_LEAD');
    expect(roundState.set).toHaveBeenCalledWith(21, 'AWAITING_LEAD');

    const emitted = io.to.mock.results.map((r) => r.value.emit);
    const bracketCall = emitted.find((e) => e.mock.calls.some((c) => c[0] === 'tournament:bracket'));
    expect(bracketCall.mock.calls[0][1]).toEqual({
      roomId: 7,
      bracket: {
        final: { duelId: 20, playerA: 1, playerB: 3 },
        thirdPlace: { duelId: 21, playerA: 2, playerB: 4 },
      },
    });
    const startCalls = emitted.flatMap((e) => e.mock.calls.filter((c) => c[0] === 'duel:start'));
    expect(startCalls).toHaveLength(2);
    expect(queriesHaveRoomClose(client)).toBe(false);
  });

  it('arms a walkover timer for an already-disconnected finalist when the finals are created (gap case)', async () => {
    const { client } = makeClient(bracketRoom, { duels: [semiA, semiB] });
    pool.connect.mockResolvedValue(client);
    // armWalkoversForDisconnected reads connected status via pool.query (it
    // runs outside the transaction, after the outer COMMIT).
    pool.query.mockResolvedValue({
      rows: [
        { player_id: 1, connected: true },
        { player_id: 3, connected: false }, // finalist disconnected before pairing existed
      ],
    });
    createDuelFromRoom
      .mockResolvedValueOnce({ id: 20, status: 'pending' })
      .mockResolvedValueOnce({ id: 21, status: 'pending' });
    const timers = { arm: vi.fn(), cancel: vi.fn() };
    const phaseStore = { set: vi.fn(), get: vi.fn() };
    const roundState = { set: vi.fn(), get: vi.fn() };

    await advanceTournamentOrRematch(io, 7, 10, { bracketWalkoverTimers: timers, phaseStore, roundState });

    expect(timers.arm).toHaveBeenCalledWith(7, 3, expect.any(Function));
    expect(timers.arm).not.toHaveBeenCalledWith(7, 1, expect.any(Function));
  });

  it('emits tournament:awaiting_round when finals exist but are not both finished', async () => {
    const pendingFinal = { ...final, status: 'pending', winner_id: null };
    const pendingThird = { ...thirdPlace, status: 'pending', winner_id: null };
    const { client } = makeClient(bracketRoom, { duels: [semiA, semiB, pendingFinal, pendingThird] });
    pool.connect.mockResolvedValue(client);

    await advanceTournamentOrRematch(io, 7, 10);

    expect(io.to).toHaveBeenCalledWith('room:7');
    expect(io.to.mock.results[0].value.emit).toHaveBeenCalledWith('tournament:awaiting_round', { roomId: 7 });
    expect(createDuelFromRoom).not.toHaveBeenCalled();
    expect(queriesHaveRoomClose(client)).toBe(false);
  });

  it('closes the room and writes final ranks 1-4 once final and third-place are both finished', async () => {    const seats = [
      { player_id: 1, nickname: 'A' },
      { player_id: 2, nickname: 'B' },
      { player_id: 3, nickname: 'C' },
      { player_id: 4, nickname: 'D' },
    ];
    const { client } = makeClient(bracketRoom, { duels: [semiA, semiB, final, thirdPlace], seats });
    pool.connect.mockResolvedValue(client);

    await advanceTournamentOrRematch(io, 7, 12);

    expect(queriesHaveRoomClose(client)).toBe(true);
    const rankUpdates = client.query.mock.calls
      .map((c) => c[0])
      .filter((sql) => sql.includes('UPDATE room_players SET final_rank'));
    expect(rankUpdates).toHaveLength(4);

    const emitted = io.to.mock.results.map((r) => r.value.emit);
    const rankingCall = emitted.find((e) => e.mock.calls.some((c) => c[0] === 'room:final_ranking'));
    expect(rankingCall.mock.calls[0][1]).toEqual({
      roomId: 7,
      ranking: [
        { playerId: 1, nickname: 'A', finalRank: 1 },
        { playerId: 3, nickname: 'C', finalRank: 2 },
        { playerId: 2, nickname: 'B', finalRank: 3 },
        { playerId: 4, nickname: 'D', finalRank: 4 },
      ],
    });
    // A finished bracket never emits awaiting_round.
    expect(emitted.some((e) => e.mock.calls.some((c) => c[0] === 'tournament:awaiting_round'))).toBe(false);
  });

  it('is an idempotent no-op (no re-rank, no re-emit) when the 4p room is already finished', async () => {
    // Two finish events (final + third-place) trigger advance near-simultaneously.
    // The second trigger reads the room as already 'finished' and must not
    // re-write ranks or re-emit room:final_ranking (concurrent-close safety).
    const finishedRoom = { id: 7, max_players: 4, status: 'finished' };
    const { client } = makeClient(finishedRoom, { duels: [semiA, semiB, final, thirdPlace] });
    pool.connect.mockResolvedValue(client);

    await advanceTournamentOrRematch(io, 7, 12);

    const rankUpdates = client.query.mock.calls
      .map((c) => c[0])
      .filter((sql) => sql.includes('UPDATE room_players SET final_rank'));
    expect(rankUpdates).toHaveLength(0);
    const emitted = io.to.mock.results.map((r) => r.value.emit);
    expect(emitted.some((e) => e.mock.calls.some((c) => c[0] === 'room:final_ranking'))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('computeFourPlayerRanks (item #7, PR 3 — assignFinalRank)', () => {
  it('maps final/third-place outcomes to ranks 1-4', () => {
    const final = { player1_id: 1, player2_id: 3, winner_id: 1 };
    const thirdPlace = { player1_id: 2, player2_id: 4, winner_id: 2 };
    expect(computeFourPlayerRanks({ final, thirdPlace })).toEqual([
      { playerId: 1, finalRank: 1 },
      { playerId: 3, finalRank: 2 },
      { playerId: 2, finalRank: 3 },
      { playerId: 4, finalRank: 4 },
    ]);
  });

  it('ranks the third-place LOSER 4th even when they are player2 of that duel', () => {
    // thirdPlace loser is player2 (id 5); the final loser is player1 (id 6).
    const final = { player1_id: 6, player2_id: 7, winner_id: 7 };
    const thirdPlace = { player1_id: 8, player2_id: 5, winner_id: 8 };
    const ranks = computeFourPlayerRanks({ final, thirdPlace });
    expect(ranks.find((r) => r.finalRank === 4)).toEqual({ playerId: 5, finalRank: 4 });
    expect(ranks.find((r) => r.finalRank === 2)).toEqual({ playerId: 6, finalRank: 2 });
  });
});

/** True if any query writes rooms.status='finished' (the close-and-rank path). */
function queriesHaveRoomClose(client) {
  return client.query.mock.calls
    .map((c) => c[0])
    .some((sql) => sql.includes("UPDATE rooms SET status = 'finished'"));
}

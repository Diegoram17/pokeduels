import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { ensureSchemaAndSeed } from './helpers.js';
import { createDuelFromRoom } from '../repositories/duelRepository.js';
import { advanceTournamentOrRematch } from '../ws/tournamentLifecycle.js';
import { createPhaseStore } from '../engine/duelPhaseStore.js';
import { createRoundStateStore } from '../ws/duelRoundState.js';

/**
 * Integration tests for the 4-player bracket lifecycle (item #7, PR 3) against
 * a real Postgres/Neon branch. Gated on DATABASE_URL (local only), self-
 * provisions schema + seed in beforeAll and cleans up its own rooms in
 * afterAll. These prove the two highest-risk concurrency/idempotency claims
 * from the design: (a) concurrent semifinal finishes create the final +
 * 3rd-place duels exactly once, and (b) a fully-resolved bracket closes the
 * room with final ranks 1-4.
 */
const { Pool } = pg;
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('tournamentLifecycle 4-player bracket (requires DATABASE_URL)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const createdRoomIds = [];

  /**
   * Creates a 4-player in_progress room with 4 seated players and NO
   * team_selections (createDuelFromRoom seeds an empty duel_pokemon_state,
   * which is irrelevant to the lifecycle's duel-row assertions). Returns the
   * room id and the 4 player ids.
   */
  async function createBracketRoom() {
    const players = [];
    for (let i = 0; i < 4; i += 1) {
      const { rows } = await pool.query(
        `INSERT INTO players (nickname) VALUES ('Brk${Date.now()}_${i}') RETURNING id`,
      );
      players.push(rows[0].id);
    }
    const code = `B${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await pool.query(
      `INSERT INTO rooms (code, max_players, status, created_by)
       VALUES ($1, 4, 'in_progress', $2) RETURNING id`,
      [code, players[0]],
    );
    const roomId = rows[0].id;
    createdRoomIds.push(roomId);
    for (let i = 0; i < 4; i += 1) {
      await pool.query(
        `INSERT INTO room_players (room_id, player_id, nickname) VALUES ($1, $2, $3)`,
        [roomId, players[i], `B${i}`],
      );
    }
    return { roomId, players };
  }

  const io = { to: () => ({ emit() {} }) };

  /**
   * Real in-memory stores for the finals-creation path (A5 latent-bug gate
   * #2): advanceTournamentOrRematch initializes the created finals' phase/round
   * state through deps, so every finals-creation call site threads fresh
   * stores exactly like the production callers do.
   */
  function lifecycleDeps() {
    return { phaseStore: createPhaseStore(), roundState: createRoundStateStore() };
  }

  /**
   * Finishes a duel with a winner. createDuelFromRoom inserts duels as
   * 'pending', and finishDuelWrite is guarded to 'in_progress', so this direct
   * UPDATE transitions a pending bracket duel to finished (the same effect the
   * walkover/repo helpers produce). The lifecycle only reads status/winner, so
   * this is a valid test stand-in for a real duel finish.
   */
  async function finishPendingDuel(duelId, winnerId) {
    await pool.query(
      `UPDATE duels SET status = 'finished', winner_id = $2, end_reason = 'ko'
       WHERE id = $1`,
      [duelId, winnerId],
    );
  }

  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
  });

  afterAll(async () => {
    if (createdRoomIds.length > 0) {
      await pool.query('DELETE FROM rooms WHERE id = ANY($1::int[])', [createdRoomIds]);
    }
    await pool.end();
  });

  it('creates the final and third-place duels exactly once even when both semifinals finish concurrently', async () => {
    const { roomId, players } = await createBracketRoom();
    const [p1, p2, p3, p4] = players;
    const semiA = await createDuelFromRoom(roomId, p1, p2, 'semifinal');
    const semiB = await createDuelFromRoom(roomId, p3, p4, 'semifinal');
    await finishPendingDuel(semiA.id, p1);
    await finishPendingDuel(semiB.id, p3);

    // Both semifinal finishes trigger the lifecycle in the same window.
    await Promise.all([
      advanceTournamentOrRematch(io, roomId, semiA.id, lifecycleDeps()),
      advanceTournamentOrRematch(io, roomId, semiB.id, lifecycleDeps()),
    ]);

    const { rows: counts } = await pool.query(
      `SELECT round, COUNT(*)::int AS n FROM duels
       WHERE room_id = $1 AND round IN ('final','tercer_puesto') GROUP BY round`,
      [roomId],
    );
    const byRound = Object.fromEntries(counts.map((r) => [r.round, r.n]));
    expect(byRound.final).toBe(1);
    expect(byRound.tercer_puesto).toBe(1);

    // The final pairs the two semifinal WINNERS (p1 vs p3, order-agnostic).
    const { rows: finalRows } = await pool.query(
      `SELECT player1_id, player2_id FROM duels WHERE room_id = $1 AND round = 'final'`,
      [roomId],
    );
    const fp = [finalRows[0].player1_id, finalRows[0].player2_id].sort((a, b) => a - b);
    expect(fp).toEqual([p1, p3].sort((a, b) => a - b));
  });

  it('closes the room with final ranks 1-4 once the final and third-place are both finished', async () => {
    const { roomId, players } = await createBracketRoom();
    const [p1, p2, p3, p4] = players;
    const semiA = await createDuelFromRoom(roomId, p1, p2, 'semifinal');
    const semiB = await createDuelFromRoom(roomId, p3, p4, 'semifinal');
    await finishPendingDuel(semiA.id, p1);
    await finishPendingDuel(semiB.id, p3);
    await advanceTournamentOrRematch(io, roomId, semiA.id, lifecycleDeps());

    // Finals now exist (winners p1,p3; losers p2,p4). Resolve them: final won
    // by p1, third-place won by p2 -> ranks p1=1, p3=2, p2=3, p4=4.
    const { rows: finals } = await pool.query(
      `SELECT id, round FROM duels WHERE room_id = $1 AND round IN ('final','tercer_puesto')`,
      [roomId],
    );
    const final = finals.find((d) => d.round === 'final');
    const third = finals.find((d) => d.round === 'tercer_puesto');
    await finishPendingDuel(final.id, p1);
    await finishPendingDuel(third.id, p2);

    await advanceTournamentOrRematch(io, roomId, final.id, lifecycleDeps());

    const { rows: roomRows } = await pool.query('SELECT status FROM rooms WHERE id = $1', [roomId]);
    expect(roomRows[0].status).toBe('finished');

    const { rows: ranks } = await pool.query(
      'SELECT player_id, final_rank FROM room_players WHERE room_id = $1 ORDER BY final_rank',
      [roomId],
    );
    expect(ranks).toEqual([
      { player_id: p1, final_rank: 1 },
      { player_id: p3, final_rank: 2 },
      { player_id: p2, final_rank: 3 },
      { player_id: p4, final_rank: 4 },
    ]);
  });

  it('does NOT create finals while a semifinal is still pending (awaiting_round)', async () => {
    const { roomId, players } = await createBracketRoom();
    const [p1, p2, p3, p4] = players;
    const semiA = await createDuelFromRoom(roomId, p1, p2, 'semifinal');
    const semiB = await createDuelFromRoom(roomId, p3, p4, 'semifinal');
    // Only semiA is finished; semiB is still pending.
    await finishPendingDuel(semiA.id, p1);

    await advanceTournamentOrRematch(io, roomId, semiA.id);

    const { rows: finals } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM duels WHERE room_id = $1 AND round IN ('final','tercer_puesto')`,
      [roomId],
    );
    expect(finals[0].n).toBe(0);
  });

  it('a walked-over semifinal still advances the bracket to the finals (walkover feeds the same pipeline)', async () => {
    const { roomId, players } = await createBracketRoom();
    const [p1, p2, p3, p4] = players;
    const semiA = await createDuelFromRoom(roomId, p1, p2, 'semifinal');
    const semiB = await createDuelFromRoom(roomId, p3, p4, 'semifinal');
    // semiA finishes normally (p1 wins); semiB is walked over, crediting p3.
    await finishPendingDuel(semiA.id, p1);
    const { finishDuelByWalkover } = await import('../repositories/duelRepository.js');
    const { applied } = await finishDuelByWalkover(semiB.id, p3);
    expect(applied).toBe(true);

    await advanceTournamentOrRematch(io, roomId, semiA.id, lifecycleDeps());

    const { rows: finals } = await pool.query(
      `SELECT round FROM duels WHERE room_id = $1 AND round IN ('final','tercer_puesto')`,
      [roomId],
    );
    expect(finals.map((d) => d.round).sort()).toEqual(['final', 'tercer_puesto']);
    // The walked-over player (p4, semiB loser) lands in the third-place duel,
    // NOT in the final — the walkover advanced p3 to the final.
    const { rows: finalRow } = await pool.query(
      `SELECT player1_id, player2_id FROM duels WHERE room_id = $1 AND round = 'final'`,
      [roomId],
    );
    const finalSeats = [finalRow[0].player1_id, finalRow[0].player2_id];
    expect(finalSeats).toContain(p3);
    expect(finalSeats).toContain(p1);
  });
});


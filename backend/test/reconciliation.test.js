import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { createRoomWithCreator } from '../db/rooms.js';
import { reconcileOrphanedDuels } from '../db/reconciliation.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';

/**
 * Boot-time orphan reconciliation (ADR-0008): every `duels` row stuck
 * `in_progress` is swept to `finished`/`server_restart`/NULL winner, and its
 * room is set to `aborted` — scoped strictly to `duels.status='in_progress'`
 * (never an independent scan of `rooms.status`).
 */
describe.skipIf(!hasDatabase)('reconcileOrphanedDuels (requires DATABASE_URL)', () => {
  const roomIds = [];
  const playerIds = [];

  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
  }, SEED_TIMEOUT);

  afterAll(async () => {
    // Rooms first (duels cascade, and rooms.created_by references players).
    if (roomIds.length) {
      await pool.query('DELETE FROM rooms WHERE id = ANY($1::int[])', [roomIds]);
    }
    if (playerIds.length) {
      await pool.query('DELETE FROM players WHERE id = ANY($1::int[])', [playerIds]);
    }
    await pool.end();
  });

  async function makeRoomAndDuel({ maxPlayers = 2, roomStatus = 'in_progress', duelStatus }) {
    const p1 = await createPlayer('ReconP1' + Math.floor(Math.random() * 1e9));
    const p2 = await createPlayer('ReconP2' + Math.floor(Math.random() * 1e9));
    playerIds.push(p1.id, p2.id);
    const room = await createRoomWithCreator(maxPlayers, p1.id);
    roomIds.push(room.id);
    await pool.query("UPDATE rooms SET status = $1 WHERE id = $2", [roomStatus, room.id]);
    const { rows } = await pool.query(
      `INSERT INTO duels (room_id, player1_id, player2_id, round, status, winner_id, end_reason)
       VALUES ($1, $2, $3, 'unica', $4, NULL, NULL)
       RETURNING id`,
      [room.id, p1.id, p2.id, duelStatus],
    );
    return { room, duelId: rows[0].id, p1, p2 };
  }

  it('reconciles multiple orphaned in-progress duels and aborts their rooms', async () => {
    const a = await makeRoomAndDuel({ duelStatus: 'in_progress' });
    const b = await makeRoomAndDuel({ duelStatus: 'in_progress' });

    const result = await reconcileOrphanedDuels();

    expect(result.duelIds).toEqual(expect.arrayContaining([a.duelId, b.duelId]));
    expect(result.roomIds).toEqual(expect.arrayContaining([a.room.id, b.room.id]));

    const { rows: duels } = await pool.query(
      'SELECT status, end_reason, winner_id FROM duels WHERE id = ANY($1::int[])',
      [[a.duelId, b.duelId]],
    );
    for (const d of duels) {
      expect(d.status).toBe('finished');
      expect(d.end_reason).toBe('server_restart');
      expect(d.winner_id).toBeNull();
    }

    const { rows: rooms } = await pool.query(
      'SELECT status FROM rooms WHERE id = ANY($1::int[])',
      [[a.room.id, b.room.id]],
    );
    for (const r of rooms) {
      expect(r.status).toBe('aborted');
    }
  });

  it('leaves non-in-progress duels untouched', async () => {
    const pending = await makeRoomAndDuel({ duelStatus: 'pending', roomStatus: 'waiting' });

    await reconcileOrphanedDuels();

    const { rows } = await pool.query(
      'SELECT status FROM duels WHERE id = $1',
      [pending.duelId],
    );
    expect(rows[0].status).toBe('pending');
    const { rows: rooms } = await pool.query(
      'SELECT status FROM rooms WHERE id = $1',
      [pending.room.id],
    );
    expect(rooms[0].status).toBe('waiting');
  });

  it('does not clobber a room already out of in_progress even when its duel is orphaned', async () => {
    const orphan = await makeRoomAndDuel({ duelStatus: 'in_progress', roomStatus: 'aborted' });

    await reconcileOrphanedDuels();

    // The duel is still swept, but the room keeps its existing status.
    const { rows: duels } = await pool.query(
      'SELECT status, end_reason FROM duels WHERE id = $1',
      [orphan.duelId],
    );
    expect(duels[0].status).toBe('finished');
    expect(duels[0].end_reason).toBe('server_restart');
    const { rows: rooms } = await pool.query(
      'SELECT status FROM rooms WHERE id = $1',
      [orphan.room.id],
    );
    expect(rooms[0].status).toBe('aborted');
  });

  it('leaves an already-finished sibling semifinal untouched while reconciling only the in-progress one', async () => {
    // Exact spec GIVEN clause ("Partial-bracket result is not preserved"): a
    // 4-player room where one semifinal duel already finished (with a
    // decided winner) and its sibling semifinal is still in_progress when
    // the boot sweep runs. Every prior test seeded exactly one duel per
    // room; this is the first to put TWO duels in the SAME room so the
    // sweep's WHERE status='in_progress' scoping is actually exercised
    // against a real sibling row, not an unrelated one.
    const winner = await createPlayer('BracketWinner' + Math.floor(Math.random() * 1e9));
    const loser = await createPlayer('BracketLoser' + Math.floor(Math.random() * 1e9));
    const p3 = await createPlayer('BracketP3' + Math.floor(Math.random() * 1e9));
    const p4 = await createPlayer('BracketP4' + Math.floor(Math.random() * 1e9));
    playerIds.push(winner.id, loser.id, p3.id, p4.id);
    const room = await createRoomWithCreator(4, winner.id);
    roomIds.push(room.id);
    await pool.query("UPDATE rooms SET status = 'in_progress' WHERE id = $1", [room.id]);

    const { rows: finishedRows } = await pool.query(
      `INSERT INTO duels (room_id, player1_id, player2_id, round, status, winner_id, end_reason)
       VALUES ($1, $2, $3, 'semifinal', 'finished', $2, 'ko')
       RETURNING id`,
      [room.id, winner.id, loser.id],
    );
    const finishedDuelId = finishedRows[0].id;

    const { rows: pendingRows } = await pool.query(
      `INSERT INTO duels (room_id, player1_id, player2_id, round, status, winner_id, end_reason)
       VALUES ($1, $2, $3, 'semifinal', 'in_progress', NULL, NULL)
       RETURNING id`,
      [room.id, p3.id, p4.id],
    );
    const inProgressDuelId = pendingRows[0].id;

    const result = await reconcileOrphanedDuels();

    expect(result.duelIds).toEqual(expect.arrayContaining([inProgressDuelId]));
    expect(result.duelIds).not.toEqual(expect.arrayContaining([finishedDuelId]));

    // The already-decided semifinal is completely untouched: same status,
    // same end_reason, same winner. No compensation, no preservation logic,
    // no rollback — it simply never matches the sweep's WHERE clause.
    const { rows: finished } = await pool.query(
      'SELECT status, end_reason, winner_id FROM duels WHERE id = $1',
      [finishedDuelId],
    );
    expect(finished[0]).toEqual({ status: 'finished', end_reason: 'ko', winner_id: winner.id });

    const { rows: inProgress } = await pool.query(
      'SELECT status, end_reason, winner_id FROM duels WHERE id = $1',
      [inProgressDuelId],
    );
    expect(inProgress[0]).toEqual({
      status: 'finished',
      end_reason: 'server_restart',
      winner_id: null,
    });

    const { rows: rooms } = await pool.query('SELECT status FROM rooms WHERE id = $1', [room.id]);
    expect(rooms[0].status).toBe('aborted');
  });

  it('is a no-op when there are no orphaned in-progress duels', async () => {
    // Only a finished duel exists — nothing should be swept.
    const done = await makeRoomAndDuel({ duelStatus: 'finished', roomStatus: 'finished' });

    const result = await reconcileOrphanedDuels();

    expect(result.duelIds).toEqual([]);
    expect(result.roomIds).toEqual([]);
    const { rows } = await pool.query('SELECT status FROM duels WHERE id = $1', [done.duelId]);
    expect(rows[0].status).toBe('finished');
  });
});

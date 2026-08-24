import { pool } from './pool.js';

/**
 * Boot-time reconciliation (ADR-0008): a crash mid-duel must not leave
 * `duels`/`rooms` stuck `in_progress` forever, which would permanently block
 * a 4-player bracket. Every `duels` row with `status='in_progress'` is swept
 * to `finished`/`server_restart`/NULL winner, and its associated room is set
 * to `aborted`.
 *
 * The sweep is scoped STRICTLY to `duels.status='in_progress'` — it never
 * independently scans `rooms.status='in_progress'` rows unlinked to an
 * in-progress duel. Errors propagate (fail closed): the caller awaits this
 * before `.listen()`, and a failure aborts boot.
 */
export async function reconcileOrphanedDuels() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: orphaned } = await client.query(
      "SELECT id, room_id FROM duels WHERE status = 'in_progress'",
    );
    const roomIds = [...new Set(orphaned.map((d) => d.room_id))];
    if (orphaned.length > 0) {
      await client.query(
        `UPDATE duels SET status = 'finished', end_reason = 'server_restart', winner_id = NULL
         WHERE id = ANY($1::int[])`,
        [orphaned.map((d) => d.id)],
      );
      await client.query(
        "UPDATE rooms SET status = 'aborted' WHERE id = ANY($1::int[]) AND status = 'in_progress'",
        [roomIds],
      );
    }
    await client.query('COMMIT');
    return { duelIds: orphaned.map((d) => d.id), roomIds };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

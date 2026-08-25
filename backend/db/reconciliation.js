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

/**
 * Boot-time reconciliation (ADR-0008 extension): a `waiting` room can only
 * exist while players hold a live WS connection to THIS process. A boot
 * means no connection from before survived it, so every room still
 * `status='waiting'` at boot time is abandoned — the in-memory reconnect
 * grace timer that would normally clean it up (reconnectTimers.js) does
 * not survive a process restart. Deletion cascades to room_players and
 * team_selections via existing FKs. Errors propagate (fail closed), same
 * contract as reconcileOrphanedDuels.
 */
export async function reconcileStaleWaitingRooms() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: stale } = await client.query(
      "SELECT id FROM rooms WHERE status = 'waiting'",
    );
    if (stale.length > 0) {
      await client.query(
        "DELETE FROM rooms WHERE id = ANY($1::int[])",
        [stale.map((r) => r.id)],
      );
    }
    await client.query('COMMIT');
    return { roomIds: stale.map((r) => r.id) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

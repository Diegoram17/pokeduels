import { pool } from '../db/pool.js';

/**
 * Post-duel tournament/rematch lifecycle (item #7). Single convergence point
 * invoked AFTER a duel finishes (design: called after
 * `finishDuel`/`finalizeDuelSideEffects`, never from inside duelLifecycle.js,
 * which keeps its tested scope boundary intact).
 *
 * It opens a transaction and locks the room row FOR UPDATE (ADR-0005), then
 * branches on `max_players`:
 *
 *   - maxPlayers === 2 (1v1 rematch, PR 1): a finished 1v1 duel decouples
 *     "a duel finished" from "the room is done". It resets BOTH seats' ready
 *     flags to false so the two players can explicitly re-ready and start a
 *     second duel through the existing room:ready -> bootstrapDuelIfReady
 *     pipeline. It does NOT write final_rank, does NOT set rooms.status to
 *     'finished', and does NOT emit room:final_ranking or any tournament event.
 *
 *   - maxPlayers === 4 (bracket, PR 3): placeholder only in this PR — the
 *     awaiting_round / final+third-place creation / full close-and-rank branch
 *     ships in PR 3.
 *
 * The transaction wraps only the room-row read + ready reset; the room is
 * never closed here for 1v1.
 *
 * @param {import('socket.io').Server} io
 * @param {number} roomId
 * @param {number} duelId
 * @returns {Promise<void>}
 */
export async function advanceTournamentOrRematch(io, roomId, duelId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT id, max_players, status FROM rooms WHERE id = $1 FOR UPDATE',
      [roomId],
    );
    const room = rows[0];

    if (room && room.max_players === 2) {
      // 1v1 rematch: reset both seats to not-ready so a rematch is an explicit
      // opt-in (re-ready), never an automatic instant one. No close, no rank,
      // no event — the room stays `in_progress`.
      await client.query('UPDATE room_players SET ready = FALSE WHERE room_id = $1', [roomId]);
    }
    // 4-player bracket branch is PR 3: for now it is a no-op (commit and
    // return without closing or resetting). `duelId` is retained in the
    // signature for the PR-3 branch to locate the finishing duel's round.

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

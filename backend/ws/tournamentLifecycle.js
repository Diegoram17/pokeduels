import { pool } from '../db/pool.js';
import { createDuelFromRoom, findPendingBracketDuelForPlayer, finishDuelByWalkover } from '../repositories/duelRepository.js';
import { PHASES, EVENTS, transition } from '../engine/stateMachine.js';
import { ROUND_SUB_STATES } from './duelRoundState.js';

/**
 * Pure 4-player bracket ranking decision (item #7, PR 3, "assignFinalRank").
 * Once the final and third-place duels are both finished, ranks are assigned
 * 1-4 deterministically from the bracket outcome:
 *
 *   - final winner        -> 1st
 *   - final loser         -> 2nd
 *   - third-place winner  -> 3rd
 *   - third-place loser   -> 4th
 *
 * The third/fourth places come from the semifinal LOSERS (both finals losers),
 * as the design specifies ("3rd/4th by semifinal loss"). Exported separately
 * so the decision is unit-testable without a DB.
 *
 * @param {{ player1_id:number, player2_id:number, winner_id:number|null }[]} final
 * @param {{ player1_id:number, player2_id:number, winner_id:number|null }[]} thirdPlace
 * @returns {{ playerId: number, finalRank: number }[]} the four seats ordered 1..4
 */
export function computeFourPlayerRanks({ final, thirdPlace }) {
  const other = (d, winnerId) => (d.player1_id === winnerId ? d.player2_id : d.player1_id);
  return [
    { playerId: final.winner_id, finalRank: 1 },
    { playerId: other(final, final.winner_id), finalRank: 2 },
    { playerId: thirdPlace.winner_id, finalRank: 3 },
    { playerId: other(thirdPlace, thirdPlace.winner_id), finalRank: 4 },
  ];
}

/**
 * Shared between-round walkover expire handler (item #7, PR 3, design decision
 * 6). Used as the expire callback of BOTH bracket-walkover arm sites (a) the
 * disconnect handler and (b) after finals creation. It re-locates the player's
 * still-pending bracket duel (robust to pairing changes), records a walkover
 * loss crediting the opponent via `finishDuelByWalkover`, funnels the finish
 * through `finalizeDuelSideEffects`, and re-advances the tournament.
 *
 * `deps.advance` is an injectable advance function (defaults to the real
 * `advanceTournamentOrRematch`) so the finish->advance chain is unit-testable
 * without stubbing the module's own self-referential call. A1-3b: the finish
 * cleanup runs through `deps.lifecycle.finalizeDuelSideEffects` (the
 * context-owned lifecycle, threaded through the deps object by every caller —
 * the module-level duelLifecycle shims are deleted).
 *
 * @param {import('socket.io').Server} io
 * @param {number} roomId
 * @param {number} playerId - the walked-over (absent) player
 * @param {{ bracketWalkoverTimers?: object, lifecycle?: object, advance?: Function }} [deps]
 * @returns {Promise<{ applied: boolean }>}
 */
export async function walkoverPendingDuel(io, roomId, playerId, deps = {}) {
  const pending = await findPendingBracketDuelForPlayer(roomId, playerId);
  if (!pending) return { applied: false };
  const opponentId = playerId === pending.player1_id ? pending.player2_id : pending.player1_id;
  const { applied } = await finishDuelByWalkover(pending.id, opponentId);
  if (!applied) return { applied: false };
  if (!deps.lifecycle?.finalizeDuelSideEffects) {
    throw new Error('walkoverPendingDuel requires deps.lifecycle (finalize path)');
  }
  await deps.lifecycle.finalizeDuelSideEffects(io, pending.id, opponentId, 'walkover');
  const advance = deps.advance ?? advanceTournamentOrRematch;
  await advance(io, roomId, pending.id, deps);
  return { applied: true };
}

/**
 * Arms a between-round walkover timer for every already-disconnected seat in a
 * 4-player room (design decision 6, arm site b). Closes the "gap before
 * pairing exists" case: a player who disconnected BEFORE their pending duel
 * was created (e.g. their semifinal finished but the finals were not yet
 * created) still gets a walkover window once the pairing exists.
 *
 * @param {import('socket.io').Server} io
 * @param {number} roomId
 * @param {{ bracketWalkoverTimers: object }} deps
 */
async function armWalkoversForDisconnected(io, roomId, deps) {
  const { bracketWalkoverTimers } = deps ?? {};
  if (!bracketWalkoverTimers) return;
  const { rows: seats } = await pool.query(
    'SELECT player_id, connected FROM room_players WHERE room_id = $1',
    [roomId],
  );
  for (const seat of seats) {
    if (seat.connected) continue;
    bracketWalkoverTimers.arm(roomId, seat.player_id, () =>
      walkoverPendingDuel(io, roomId, seat.player_id, deps),
    );
  }
}

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
 *   - maxPlayers === 4 (bracket, PR 3): reads the room's duels and advances
 *     the bracket:
 *       * one semifinal still not finished  -> emit tournament:awaiting_round
 *       * both semifinals done, finals missing -> create the 'final' (winners)
 *         and 'tercer_puesto' (losers) duels idempotently via
 *         createDuelFromRoom (releasing the room lock first), arm walkovers
 *         for already-disconnected participants, emit tournament:bracket + 2x
 *         duel:start
 *       * finals exist but not both finished -> emit tournament:awaiting_round
 *       * final + third-place both finished -> assign final_rank 1-4
 *         (computeFourPlayerRanks), set rooms.status='finished', emit
 *         room:final_ranking exactly once. A bracket room never offers a
 *         rematch.
 *
 * Concurrency: the outer room lock is released BEFORE createDuelFromRoom
 * (transactions cannot nest on one client). Duplicate-creation safety comes
 * entirely from createDuelFromRoom's OWN FOR UPDATE + round/pair-scoped
 * idempotent check — a concurrent trigger blocks there, then sees the just-
 * inserted row and returns it.
 *
 * @param {import('socket.io').Server} io
 * @param {number} roomId
 * @param {number} duelId - the duel that just finished (locates the round)
 * @param {{ bracketWalkoverTimers?: object }} [deps] - injected registry for
 *        the bracket-walkover arm site (b)
 * @returns {Promise<void>}
 */
export async function advanceTournamentOrRematch(io, roomId, duelId, deps = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT id, max_players, status FROM rooms WHERE id = $1 FOR UPDATE',
      [roomId],
    );
    const room = rows[0];

    if (!room) {
      await client.query('COMMIT');
      return;
    }

    if (room.max_players === 2) {
      // 1v1 rematch: reset both seats to not-ready so a rematch is an explicit
      // opt-in (re-ready), never an automatic instant one. No close, no rank,
      // no event — the room stays `in_progress`.
      await client.query('UPDATE room_players SET ready = FALSE WHERE room_id = $1', [roomId]);
      await client.query('COMMIT');
      return;
    }

    // 4-player bracket branch (PR 3). An already-finished/aborted room is an
    // idempotent no-op: a second finish event (both finals resolving
    // near-simultaneously) must never re-rank or re-emit room:final_ranking.
    if (room.status !== 'in_progress') {
      await client.query('COMMIT');
      return;
    }

    // ---- 4-player bracket branch (PR 3) ----
    const { rows: duels } = await client.query(
      'SELECT id, player1_id, player2_id, round, status, winner_id FROM duels WHERE room_id = $1 ORDER BY id ASC',
      [roomId],
    );
    const semis = duels.filter((d) => d.round === 'semifinal');
    const final = duels.find((d) => d.round === 'final');
    const thirdPlace = duels.find((d) => d.round === 'tercer_puesto');

    const semisDone = semis.length === 2 && semis.every((d) => d.status === 'finished');
    const finalsMissing = !final || !thirdPlace;
    const finalsDone =
      !!final && !!thirdPlace && final.status === 'finished' && thirdPlace.status === 'finished';

    if (!semisDone) {
      // Still waiting on a semifinal: nothing to create yet.
      await client.query('COMMIT');
      io.to(`room:${roomId}`).emit('tournament:awaiting_round', { roomId });
      return;
    }

    if (finalsMissing) {
      // Both semifinals are done but the final/3rd-place pair is missing.
      // Release the room lock before createDuelFromRoom (cannot nest a
      // transaction on this client); idempotency lives in createDuelFromRoom.
      await client.query('COMMIT');

      const [semiA, semiB] = [...semis].sort((a, b) => a.id - b.id);
      const other = (d, winnerId) => (d.player1_id === winnerId ? d.player2_id : d.player1_id);
      const finalists = [semiA.winner_id, semiB.winner_id];
      const thirdPlaceSeats = [other(semiA, semiA.winner_id), other(semiB, semiB.winner_id)];

      const finalDuel = await createDuelFromRoom(roomId, finalists[0], finalists[1], 'final');
      const thirdDuel = await createDuelFromRoom(roomId, thirdPlaceSeats[0], thirdPlaceSeats[1], 'tercer_puesto');

      // Both finals duels enter the same lead-selection window as the semis
      // (A5 latent-bug gate #2): without phase/round init, the F1 phase guard
      // rejects every bracket duel:select_lead. The stores come from the deps
      // threaded by every production caller (turnCycle / roomHandlers /
      // duelHandlers) — the bracket is unplayable over WS without them.
      if (!deps.phaseStore || !deps.roundState) {
        throw new Error('advanceTournamentOrRematch requires deps.phaseStore + deps.roundState (finals init)');
      }
      deps.phaseStore.set(finalDuel.id, transition(PHASES.PENDING, EVENTS.START));
      deps.roundState.set(finalDuel.id, ROUND_SUB_STATES.AWAITING_LEAD);
      deps.phaseStore.set(thirdDuel.id, transition(PHASES.PENDING, EVENTS.START));
      deps.roundState.set(thirdDuel.id, ROUND_SUB_STATES.AWAITING_LEAD);

      // Arm site (b): a participant who is already disconnected gets a walkover
      // window over their freshly-created pending duel (the "gap" case).
      await armWalkoversForDisconnected(io, roomId, deps);

      io.to(`room:${roomId}`).emit('tournament:bracket', {
        roomId,
        bracket: {
          final: { duelId: finalDuel.id, playerA: finalists[0], playerB: finalists[1] },
          thirdPlace: { duelId: thirdDuel.id, playerA: thirdPlaceSeats[0], playerB: thirdPlaceSeats[1] },
        },
      });
      io.to(`room:${roomId}`).emit('duel:start', { duelId: finalDuel.id });
      io.to(`room:${roomId}`).emit('duel:start', { duelId: thirdDuel.id });
      return;
    }

    if (!finalsDone) {
      // Finals exist but one is still in flight.
      await client.query('COMMIT');
      io.to(`room:${roomId}`).emit('tournament:awaiting_round', { roomId });
      return;
    }

    // Both finals finished: assign ranks 1-4 and close the room.
    const ranks = computeFourPlayerRanks({ final, thirdPlace });

    const { rows: seatRows } = await client.query(
      'SELECT player_id, nickname FROM room_players WHERE room_id = $1',
      [roomId],
    );
    for (const { playerId, finalRank } of ranks) {
      await client.query(
        'UPDATE room_players SET final_rank = $1 WHERE room_id = $2 AND player_id = $3',
        [finalRank, roomId, playerId],
      );
    }
    await client.query("UPDATE rooms SET status = 'finished' WHERE id = $1", [roomId]);

    const ranking = ranks.map(({ playerId, finalRank }) => {
      const seat = seatRows.find((s) => s.player_id === playerId);
      return { playerId, nickname: seat?.nickname ?? null, finalRank };
    });

    await client.query('COMMIT');
    io.to(`room:${roomId}`).emit('room:final_ranking', { roomId, ranking });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

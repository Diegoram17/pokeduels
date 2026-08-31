import { getRoomState } from '../db/rooms.js';
import { createDuelFromRoom } from '../repositories/duelRepository.js';
import { PHASES, EVENTS, transition } from '../engine/stateMachine.js';
import { ROUND_SUB_STATES } from './duelRoundState.js';

/**
 * Duel bootstrap (item #5, design: "bootstrap trigger & scope"). Called by the
 * room:ready handler AFTER the room:state broadcast. Creates the duel only
 * when the room is a full 1v1 (maxPlayers === 2) with every seated player
 * ready, then:
 *
 *   1. createDuelFromRoom — duels row (pending) + duel_pokemon_state seeded
 *      from team_selections + rooms.status -> in_progress (idempotent)
 *   2. advances the coarse engine FSM pending -> lead_selection
 *   3. sets the WS round sub-state to AWAITING_LEAD
 *   4. broadcasts `duel:start { duelId }` to the whole `room:{roomId}` channel
 *      (both sockets are already seated there; each client then emits
 *      `duel:join` to subscribe to the duel channel)
 *
 * 4-player rooms are explicitly skipped — the bracket generator (#7) owns them.
 * A room whose status already left `waiting` is skipped too (no double
 * bootstrap), which is the WS-layer half of the idempotency guarantee (the
 * repository function itself is idempotent as well).
 *
 * @param {import('socket.io').Server} io
 * @param {number} roomId
 * @param {object} ctx - the DuelContext composition root (spec A1): the phase
 *        store and round sub-state store resolve from it
 * @returns {Promise<{ id: number, status: string } | undefined>} the duel, or
 *          undefined when the readiness gate did not open
 */
export async function bootstrapDuelIfReady(io, roomId, ctx) {
  const roomState = await getRoomState(roomId);
  if (!roomState) return undefined;

  const { maxPlayers, players, status } = roomState;
  const full1v1Ready =
    maxPlayers === 2 &&
    players.length === maxPlayers &&
    players.every((p) => p.ready);

  // Readiness gate (item #7, PR 1 rematch): the first duel starts from a
  // `waiting` room; a rematch starts from an `in_progress` 1v1 room whose
  // previous duel finished (ready flags were reset, so both re-readying opens
  // this gate again). Any other status — `finished` (room closed) or
  // `aborted` — must never open a new duel. Double-firing mid-duel is safe:
  // createDuelFromRoom's scoped existing-check returns the in-flight duel
  // instead of duplicating it.
  const canBootstrap = status === 'waiting' || status === 'in_progress';
  if (!full1v1Ready || !canBootstrap) return undefined;

  const [player1, player2] = players;
  const duel = await createDuelFromRoom(roomId, player1.playerId, player2.playerId);

  ctx.phaseStore.set(duel.id, transition(PHASES.PENDING, EVENTS.START));
  ctx.roundState.set(duel.id, ROUND_SUB_STATES.AWAITING_LEAD);

  io.to(`room:${roomId}`).emit('duel:start', { duelId: duel.id });
  return duel;
}

/**
 * Pure Fisher-Yates shuffle (exported for test injection). Returns a NEW array
 * with the input's elements in a uniformly random order; the input is never
 * mutated. The bracket pairing uses this so the two semifinals are randomly
 * paired per spec (RF-5.3).
 *
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
export function fisherYatesShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 4-player bracket bootstrap (item #7, PR 3, design decision 3). Sibling of
 * `bootstrapDuelIfReady`, called from `room:ready` alongside it. Opens the
 * bracket ONLY when the room is a full 4-player room (maxPlayers === 4, all
 * four seated, every one ready) still in `waiting` status, then:
 *
 *   1. randomly pairs the 4 seats into 2 semifinal duels (Fisher-Yates),
 *   2. creates both via `createDuelFromRoom(roomId, pA, pB, 'semifinal')` —
 *      its round+pair-scoped idempotent check makes the two calls safe,
 *   3. broadcasts `tournament:bracket` (the semifinal pairing by slot) and a
 *      `duel:start` per semifinal to the whole `room:{roomId}` channel.
 *
 * `shuffle` is injectable for deterministic tests (default: fisherYatesShuffle).
 *
 * @param {import('socket.io').Server} io
 * @param {number} roomId
 * @param {object} ctx - the DuelContext composition root (spec A1); threaded
 *        for the caller contract (3b consumes it — the bracket path writes no
 *        phase/round state in 3a)
 * @param {(arr: number[]) => number[]} [shuffle]
 * @returns {Promise<{ semiA: object, semiB: object } | undefined>}
 */
export async function bootstrapBracketIfReady(io, roomId, ctx, shuffle = fisherYatesShuffle) {
  const roomState = await getRoomState(roomId);
  if (!roomState) return undefined;

  const { maxPlayers, players, status } = roomState;
  const full4Ready =
    maxPlayers === 4 &&
    players.length === maxPlayers &&
    players.every((p) => p.ready);

  // The bracket starts exactly once from a `waiting` room when all 4 seats are
  // ready. Any other status (in_progress / finished / aborted) must never
  // re-pair. 1v1 rooms are bootstrapDuelIfReady's job.
  if (!full4Ready || status !== 'waiting') return undefined;

  const [p1, p2, p3, p4] = shuffle(players.map((p) => p.playerId));
  const semiA = await createDuelFromRoom(roomId, p1, p2, 'semifinal');
  const semiB = await createDuelFromRoom(roomId, p3, p4, 'semifinal');

  // Both semifinals enter the same lead-selection window as the 1v1 path
  // (A5 latent-bug gate #2): without phase/round init, the F1 phase guard in
  // duel:select_lead rejects every bracket duel — the 4-player bracket was
  // unplayable over WS.
  ctx.phaseStore.set(semiA.id, transition(PHASES.PENDING, EVENTS.START));
  ctx.roundState.set(semiA.id, ROUND_SUB_STATES.AWAITING_LEAD);
  ctx.phaseStore.set(semiB.id, transition(PHASES.PENDING, EVENTS.START));
  ctx.roundState.set(semiB.id, ROUND_SUB_STATES.AWAITING_LEAD);

  io.to(`room:${roomId}`).emit('tournament:bracket', {
    roomId,
    bracket: {
      semiA: { duelId: semiA.id, playerA: p1, playerB: p2 },
      semiB: { duelId: semiB.id, playerA: p3, playerB: p4 },
    },
  });
  io.to(`room:${roomId}`).emit('duel:start', { duelId: semiA.id });
  io.to(`room:${roomId}`).emit('duel:start', { duelId: semiB.id });
  return { semiA, semiB };
}
import { getRoomState } from '../db/rooms.js';
import { createDuelFromRoom } from '../repositories/duelRepository.js';
import { PHASES, EVENTS, transition } from '../engine/stateMachine.js';
import { getPhaseStore } from '../engine/duelPhaseStore.js';
import { getRoundStateStore, ROUND_SUB_STATES } from './duelRoundState.js';

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
 * @returns {Promise<{ id: number, status: string } | undefined>} the duel, or
 *          undefined when the readiness gate did not open
 */
export async function bootstrapDuelIfReady(io, roomId) {
  const roomState = await getRoomState(roomId);
  if (!roomState) return undefined;

  const { maxPlayers, players, status } = roomState;
  const full1v1Ready =
    maxPlayers === 2 &&
    players.length === maxPlayers &&
    players.every((p) => p.ready);
  if (!full1v1Ready || status !== 'waiting') return undefined;

  const [player1, player2] = players;
  const duel = await createDuelFromRoom(roomId, player1.playerId, player2.playerId);

  getPhaseStore().set(duel.id, transition(PHASES.PENDING, EVENTS.START));
  getRoundStateStore().set(duel.id, ROUND_SUB_STATES.AWAITING_LEAD);

  io.to(`room:${roomId}`).emit('duel:start', { duelId: duel.id });
  return duel;
}
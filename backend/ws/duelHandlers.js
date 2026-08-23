import { WsError } from '../lib/wsError.js';
import { getDuelState, mapDuelStateToCamelCase } from '../repositories/duelRepository.js';
import { withWsHandler } from './wsFaultIsolation.js';

/**
 * Registers the duel event handlers for one connected socket (item #5). Every
 * handler runs inside withWsHandler: WsErrors (validation + participant
 * rejections) are emitted to the client as `duel:*_rejected` events; genuine
 * faults are logged and swallowed so one bad request never crashes the shared
 * process (ADR-0001). Identity comes from the auth middleware
 * (socket.data.player), and every handler re-validates against canonical DB
 * state (ENG-04 — the client is never trusted).
 *
 * Participant gate: a socket may only act on duels where its player id is
 * player1 or player2. Broadcasts go to the `duel:{duelId}` channel, which
 * sockets enter via `duel:join`.
 */

/**
 * Fetches the canonical duel state only when `playerId` is a participant of
 * `duelId`. Returns the state, or null when the duel is unknown, the id is
 * malformed, or the player is not part of it (each caller maps null to its
 * own rejection event + reason).
 */
async function fetchDuelForParticipant(duelId, playerId) {
  if (!Number.isInteger(duelId) || duelId <= 0) return null;
  const state = await getDuelState(duelId);
  if (!state) return null;
  const { player1_id, player2_id } = state.duel;
  if (playerId !== player1_id && playerId !== player2_id) return null;
  return state;
}

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function registerDuelHandlers(io, socket) {
  socket.on('duel:join', (payload) =>
    withWsHandler(socket, async () => {
      const duelId = payload?.duelId;
      const playerId = socket.data.player.id;

      const state = await fetchDuelForParticipant(duelId, playerId);
      if (!state) {
        throw new WsError('duel:join_rejected', { duelId, reason: 'not_participant' });
      }

      socket.join(`duel:${duelId}`);
      socket.emit('duel:state', mapDuelStateToCamelCase(state));
    }),
  );
}
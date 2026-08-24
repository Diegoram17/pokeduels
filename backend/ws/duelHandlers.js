import { WsError } from '../lib/wsError.js';
import {
  getDuelState,
  mapDuelStateToCamelCase,
  activateLead,
  applySwitchDecision,
  markDuelInProgress,
} from '../repositories/duelRepository.js';
import { ValidationError } from '../engine/switchValidation.js';
import { PHASES, EVENTS, transition } from '../engine/stateMachine.js';
import { getPhaseStore } from '../engine/duelPhaseStore.js';
import { getRoundStateStore, ROUND_SUB_STATES } from './duelRoundState.js';
import { withWsHandler } from './wsFaultIsolation.js';
import { createDuelLifecycle } from './duelLifecycle.js';

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
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {{ turnTimers?: object, turnCycle?: object }} [deps] - injected
 *        per-duel turn timer registry (composition root, injectable
 *        timeoutMs) and the shared turn cycle (factory singleton)
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

/** Maps a switchValidation ValidationError to the handler's rejection WsError. */
function toRejectionWsError(event, err, extra = {}) {
  if (err instanceof ValidationError) {
    return new WsError(event, { ...extra, reason: err.reason });
  }
  throw err;
}

export function registerDuelHandlers(io, socket, { turnTimers, turnCycle } = {}) {
  // Item #6 centralized finish path, bound to THIS server's turn-timer
  // registry (composition root) so the correct pending 10s window is cancelled
  // on surrender/disconnect (PR 2 note: never the default singleton for
  // handlers that own a per-server registry).
  const lifecycle = createDuelLifecycle({ turnTimers });

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

  socket.on('duel:select_lead', (payload) =>
    withWsHandler(socket, async () => {
      const { duelId, pokemonId } = payload ?? {};
      const playerId = socket.data.player.id;

      if (!Number.isInteger(pokemonId) || pokemonId <= 0) {
        throw new WsError('duel:lead_rejected', { pokemonId, reason: 'invalid' });
      }
      const state = await fetchDuelForParticipant(duelId, playerId);
      if (!state) {
        throw new WsError('duel:lead_rejected', { pokemonId, reason: 'not_participant' });
      }

      try {
        await activateLead(duelId, playerId, pokemonId);
      } catch (err) {
        throw toRejectionWsError('duel:lead_rejected', err, { pokemonId });
      }

      // Lead readiness is tracked in the WS layer; only when BOTH players
      // picked does the coarse engine FSM advance lead_selection ->
      // in_progress (design: stateMachine.js is never widened). The coarse
      // duels.status column follows: this is the moment the duel goes LIVE
      // (item #6's in_progress-guarded repository operations depend on it).
      const roundState = getRoundStateStore();
      roundState.markLeadReady(duelId, playerId);
      if (roundState.bothLeadsReady(duelId) && getPhaseStore().get(duelId) === PHASES.LEAD_SELECTION) {
        getPhaseStore().set(duelId, transition(PHASES.LEAD_SELECTION, EVENTS.SELECT_LEADS));
        roundState.set(duelId, ROUND_SUB_STATES.AWAITING_ACTIONS);
        await markDuelInProgress(duelId);
      }
    }),
  );

  socket.on('duel:switch_decision', (payload) =>
    withWsHandler(socket, async () => {
      const { duelId, switchTo } = payload ?? {};
      const playerId = socket.data.player.id;

      const state = await fetchDuelForParticipant(duelId, playerId);
      if (!state) {
        throw new WsError('duel:switch_rejected', { switchTo, reason: 'not_participant' });
      }

      // switchTo null/undefined = keep the current active (TECH-DESIGN §5.2);
      // the forced-switch prompt is cleared and play resumes.
      if (switchTo === null || switchTo === undefined) {
        getRoundStateStore().set(duelId, ROUND_SUB_STATES.AWAITING_ACTIONS);
        return;
      }
      if (!Number.isInteger(switchTo) || switchTo <= 0) {
        throw new WsError('duel:switch_rejected', { switchTo, reason: 'invalid' });
      }

      try {
        await applySwitchDecision(duelId, playerId, switchTo);
      } catch (err) {
        throw toRejectionWsError('duel:switch_rejected', err, { switchTo });
      }
      getRoundStateStore().set(duelId, ROUND_SUB_STATES.AWAITING_ACTIONS);
    }),
  );

  socket.on('duel:select_action', (payload) =>
    withWsHandler(socket, async () => {
      const { duelId, moveIndex } = payload ?? {};
      const playerId = socket.data.player.id;

      if (!Number.isInteger(moveIndex) || moveIndex < 1 || moveIndex > 4) {
        throw new WsError('duel:action_rejected', { moveIndex, reason: 'invalid_move' });
      }
      const state = await fetchDuelForParticipant(duelId, playerId);
      if (!state) {
        throw new WsError('duel:action_rejected', { moveIndex, reason: 'not_participant' });
      }

      // PP pre-validation BEFORE buffering (design decision, confirmed #189.2):
      // a 0-PP move (moves 1-3) is rejected to the emitting socket only — the
      // action never enters the buffer and the 10s round timer keeps running,
      // so the client can re-pick without waiting for the round. Move 4 is
      // always eligible (no PP cost).
      const roster = state.pokemonStates.filter((p) => p.player_id === playerId);
      const active = roster.find((p) => p.is_active);
      if (!active) {
        throw new WsError('duel:action_rejected', { moveIndex, reason: 'no_active_pokemon' });
      }
      if (moveIndex !== 4 && active[`pp_move_${moveIndex}`] === 0) {
        throw new WsError('duel:action_rejected', { moveIndex, reason: 'insufficient_pp' });
      }

      const action = { moveIndex };
      const { isFirst, pairComplete } = turnCycle.bufferAction(duelId, playerId, action);

      // First action of the pair arms the 10s window; on expiry the missing
      // player's timeout action is filled and the round resolves.
      if (isFirst) {
        turnTimers.start(duelId, async () => {
          await turnCycle.bufferTimeoutAction(duelId);
          await turnCycle.attemptResolveTurn(io, duelId);
        });
      }
      // Pair complete: cancel the timer and resolve now (the timer callback
      // would only fill an action for a player who already acted).
      if (pairComplete) {
        turnTimers.cancel(duelId);
        await turnCycle.attemptResolveTurn(io, duelId);
      }
    }),
  );

  socket.on('duel:surrender', (payload) =>
    withWsHandler(socket, async () => {
      const duelId = payload?.duelId;
      const playerId = socket.data.player.id;

      // Server-side re-validation (RF-5.5): the client-side confirmation
      // dialog is never trusted (ENG-04). The surrender is accepted ONLY for
      // a participant of a duel whose coarse status is still in_progress.
      const state = await fetchDuelForParticipant(duelId, playerId);
      if (!state) {
        throw new WsError('duel:surrender_rejected', { duelId, reason: 'not_participant' });
      }
      if (state.duel.status !== 'in_progress') {
        throw new WsError('duel:surrender_rejected', { duelId, reason: 'not_in_progress' });
      }

      const { player1_id, player2_id } = state.duel;
      const opponentId = playerId === player1_id ? player2_id : player1_id;
      await lifecycle.finishDuel(io, duelId, opponentId, 'surrender');
    }),
  );
}
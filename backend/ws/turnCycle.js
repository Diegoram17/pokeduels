import {
  getDuelState,
  mapDuelStateToCamelCase,
  mapRoundEventsToCamelCase,
} from '../repositories/duelRepository.js';
import { resolverRonda } from '../engine/roundResolver.js';
import { withDuelFaultIsolation } from '../engine/faultIsolation.js';
import { ROUND_SUB_STATES } from './duelRoundState.js';
import { advanceTournamentOrRematch } from './tournamentLifecycle.js';

/**
 * Per-duel action buffer + shared turn-resolution trigger (item #5, design:
 * "the shared buffer is what produces the resolution, not the timer"). Each
 * player's `duel:select_action` lands in a per-duel `Map<playerId, action>`;
 * `attemptResolveTurn` fires `resolverRonda` once BOTH actions are present,
 * then broadcasts the outcome to the `duel:{duelId}` channel.
 *
 * The 10s timer stays a plain side-effecting callback (turnTimers.js): on
 * expiry it fills the missing player's timeout action via
 * `bufferTimeoutAction` and calls `attemptResolveTurn`. The turn timer itself
 * is created in the composition root and coordinated by the handler — this
 * module never touches the timer registry.
 *
 * A1-3b: factory-only shape. The module singletons (`getTurnCycle` /
 * `resetTurnCycle`) and the direct `duelLifecycle.js` import are GONE. The
 * composition root injects the round sub-state store and phase store at
 * construction and wires the finish lifecycle through `bindLifecycle` (two-
 * phase init) — the circular import turnCycle <-> duelLifecycle is broken:
 * this module resolves `lifecycle.finalizeDuelSideEffects` only through the
 * bound reference, never through a module import.
 */
export function createTurnCycle({ bracketWalkoverTimers, roundState, phaseStore } = {}) {
  const buffers = new Map();
  let lifecycle = null;

  return {
    /**
     * One-shot setter wiring the finish lifecycle into the resolution path
     * (design: two-phase init, step 7 of DuelContext construction). Must be
     * called before any turn can resolve; a second bind is a programming
     * error.
     */
    bindLifecycle(l) {
      if (lifecycle) {
        throw new Error('turnCycle lifecycle already bound (bindLifecycle runs once)');
      }
      lifecycle = l;
    },

    /**
     * Buffers one player's action for a duel. Returns `{ isFirst,
     * pairComplete }` so the caller knows whether to arm the 10s timer
     * (first action) or resolve immediately (pair complete). A re-pick
     * replaces the player's previous action.
     */
    bufferAction(duelId, playerId, action) {
      let buffer = buffers.get(duelId);
      if (!buffer) {
        buffer = new Map();
        buffers.set(duelId, buffer);
      }
      const isFirst = buffer.size === 0;
      buffer.set(playerId, action);
      return { isFirst, pairComplete: buffer.size === 2 };
    },

    /**
     * Fills the timeout action `{ moveIndex: 4, wasTimeout: true }` for the
     * one player who has not acted yet (called by the expired turn timer).
     * Uses the canonical duel state to learn the player pair; no-op when the
     * buffer is full, missing, or both players already acted.
     *
     * @returns {Promise<number|null>} the filled playerId, or null
     */
    async bufferTimeoutAction(duelId) {
      const buffer = buffers.get(duelId);
      if (!buffer || buffer.size >= 2) return null;

      const state = await getDuelState(duelId);
      if (!state) return null;
      const { player1_id, player2_id } = state.duel;
      const acted = new Set(buffer.keys());
      const missing = [player1_id, player2_id].find((p) => !acted.has(p));
      if (missing === undefined) return null;

      buffer.set(missing, { moveIndex: 4, wasTimeout: true });
      return missing;
    },

    /**
     * Resolves the round once both actions are buffered: runs
     * `resolverRonda` under per-duel fault isolation, then broadcasts
     * `duel:turn_resolved` (camelCase state) to `duel:{duelId}` and advances
     * the WS round sub-state — AWAITING_SWITCH on a KO that is not a team
     * wipe (+ `duel:awaiting_switch`), `duel:finished` on a team wipe,
     * AWAITING_ACTIONS otherwise. Returns false when the round is not ready
     * or a genuine fault aborted it.
     */
    async attemptResolveTurn(io, duelId) {
      const buffer = buffers.get(duelId);
      if (!buffer || buffer.size < 2) return false;

      const state = await getDuelState(duelId);
      if (!state) return false;
      const { player1_id, player2_id } = state.duel;
      const accionP1 = buffer.get(player1_id);
      const accionP2 = buffer.get(player2_id);
      if (!accionP1 || !accionP2) return false;

      buffers.delete(duelId);
      roundState.set(duelId, ROUND_SUB_STATES.RESOLVING);

      const isolated = await withDuelFaultIsolation(duelId, () =>
        resolverRonda(duelId, accionP1, accionP2, { phaseStore }),
      );
      if (!isolated.ok) {
        // Genuine fault — the turn did not happen; let both players retry.
        roundState.set(duelId, ROUND_SUB_STATES.AWAITING_ACTIONS);
        return false;
      }

      const fresh = await getDuelState(duelId);
      // Fase 7 (PR7): forward the round resolver's ordered `events` list as the
      // additive `turnEvents` payload field (server-authoritative attack
      // replay). The no-op guard path (resolverRonda returns { applied:false })
      // has no events — mapRoundEventsToCamelCase yields [].
      const resolvedEvents = isolated.result?.events;
      io.to(`duel:${duelId}`).emit('duel:turn_resolved', {
        ...mapDuelStateToCamelCase(fresh),
        turnEvents: mapRoundEventsToCamelCase(resolvedEvents),
      });

      if (fresh.duel.status === 'finished') {
        // Team wipe — the round resolution already persisted the finish
        // (applyRoundResult's guarded transactional write). Route the post-write
        // cleanup + broadcast through the centralized lifecycle (item #6) so
        // KO shares one finalize path with surrender/disconnect, then
        // re-advance the tournament (item #7) so a 4p bracket progresses. The
        // lifecycle is the bound reference from bindLifecycle (A1-3b).
        await lifecycle.finalizeDuelSideEffects(
          io,
          duelId,
          fresh.duel.winner_id ?? null,
          'ko',
        );
        await advanceTournamentOrRematch(io, fresh.duel.room_id, duelId, {
          bracketWalkoverTimers,
          lifecycle,
          phaseStore,
          roundState,
        });
        return true;
      }

      const needingSwitch = [player1_id, player2_id].filter((pid) => {
        const owned = fresh.pokemonStates.filter((p) => p.player_id === pid);
        return !owned.some((p) => p.is_active) && owned.some((p) => !p.fainted);
      });
      if (needingSwitch.length > 0) {
        roundState.set(duelId, ROUND_SUB_STATES.AWAITING_SWITCH);
        io.to(`duel:${duelId}`).emit('duel:awaiting_switch', { duelId });
        return true;
      }

      roundState.set(duelId, ROUND_SUB_STATES.AWAITING_ACTIONS);
      return true;
    },

    /** True while any action is buffered for the duel (test/debug aid). */
    hasBuffered(duelId) {
      return buffers.has(duelId);
    },

    /**
     * Drops one duel's buffered actions (item #6 finish cleanup). Per-duel —
     * never the global `clear()`, which wipes every concurrent duel's buffer
     * and is test/shutdown-only. No-op on a missing key.
     */
    dropBuffer(duelId) {
      buffers.delete(duelId);
    },

    /** Drops every buffered action (test teardown / server shutdown). */
    clear() {
      buffers.clear();
    },
  };
}
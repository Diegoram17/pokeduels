import { calcularDaño } from './damageCalc.js';
import { getMultiplier, getEffectivenessCache } from './typeEffectiveness.js';
import { PHASES, EVENTS, transition } from './stateMachine.js';
import { getPhaseStore } from './duelPhaseStore.js';
import { getDuelState, applyRoundResult } from '../repositories/duelRepository.js';

/**
 * Pure round-resolution core (Phase 2). No I/O — the caller supplies the full
 * canonical duel state, an injected type-effectiveness cache, and an injectable
 * RNG for deterministic tests of both turn-order branches. The I/O orchestrator
 * (`resolverRonda`) that fetches canonical state and persists the result is a
 * Phase 3 (PR 3) deliverable.
 *
 * State shape (mirrors canonical DB rows; `type` joined from `pokemons`):
 *   duelState = {
 *     duel: { id, player1_id, player2_id, status, winner_id, end_reason, turn_number },
 *     pokemonStates: [{ id, duel_id, player_id, pokemon_id, current_hp,
 *                       pp_move_1, pp_move_2, pp_move_3, is_active, fainted, type }],
 *   }
 *
 * Actions are positional: accionP1 belongs to duel.player1_id, accionP2 to
 * duel.player2_id. Each action: { moveIndex: 1..4, wasTimeout?: boolean }.
 *
 * PP eligibility (design amendment, superseding the spec's old silent
 * substitution): moves 1-3 require pp_move_N > 0; move 4 carries no PP cost
 * (Infinity) and is never rejected. A 0-PP action is REJECTED with
 * { type: 'rejected', reason: 'insufficient_pp' } — no state mutation, no
 * moveRows entry, not thrown, not routed through fault isolation.
 *
 * @returns {{ events: object[], nextDuelState: object, moveRows: object[], nextPhase: string }}
 */

function activePokemon(state, playerId) {
  return state.pokemonStates.find((p) => p.player_id === playerId && p.is_active);
}

function opponentOf(state, playerId) {
  const { player1_id, player2_id } = state.duel;
  return playerId === player1_id ? player2_id : player1_id;
}

function hasNonFainted(state, playerId) {
  return state.pokemonStates.some((p) => p.player_id === playerId && !p.fainted);
}

function makeMoveRow(state, action, attacker, defender, damageDealt, effectiveness) {
  return {
    duel_id: state.duel.id,
    player_id: action.playerId,
    action_type: 'attack',
    pokemon_id: attacker.pokemon_id,
    move_index: action.moveIndex,
    target_pokemon_id: defender.pokemon_id,
    damage_dealt: damageDealt,
    effectiveness,
    was_timeout: Boolean(action.wasTimeout),
    turn_number: 0, // stamped below once the turn is known
  };
}

export function resolveRoundLogic(
  duelState,
  accionP1,
  accionP2,
  { rng = Math.random, effectivenessCache } = {},
) {
  // Deep clone so the caller's state object is never mutated (pure core).
  const state = structuredClone(duelState);
  const { player1_id, player2_id } = state.duel;

  const actions = [
    { playerId: player1_id, ...accionP1 },
    { playerId: player2_id, ...accionP2 },
  ];

  const events = [];
  const moveRows = [];

  // Snapshot each player's starting active pokemon. A KO sets is_active=false
  // on the fainted pokemon, so the round's skip check must look at the pokemon
  // that WAS active at round start — not re-query for an is_active survivor.
  const actives = {
    [player1_id]: activePokemon(state, player1_id),
    [player2_id]: activePokemon(state, player2_id),
  };

  // 1. PP eligibility — a 0-PP move (moves 1-3) is rejected up front and
  //    excluded from random-order resolution entirely. Move 4 always eligible.
  const eligible = actions.filter((action) => {
    const attacker = actives[action.playerId];
    if (attacker === undefined) {
      throw new Error(
        `Player ${action.playerId} has no active pokemon — cannot resolve round`,
      );
    }
    const ppLeft = attacker[`pp_move_${action.moveIndex}`];
    if (ppLeft === 0) {
      events.push({
        type: 'rejected',
        playerId: action.playerId,
        moveIndex: action.moveIndex,
        reason: 'insufficient_pp',
      });
      return false;
    }
    return true;
  });

  // 2. Random resolution order among eligible actions (rng only invoked when
  //    there is an order to randomize — i.e. both actions are eligible).
  let order = eligible;
  if (eligible.length === 2) {
    order = rng() < 0.5 ? eligible : [...eligible].reverse();
  }

  // 3. Resolve in order.
  for (const action of order) {
    const attacker = actives[action.playerId];
    const defender = actives[opponentOf(state, action.playerId)];

    if (attacker.fainted) {
      // The actor's active pokemon was knocked out by the first action this
      // round — a legitimate in-round outcome, so it still gets a moveRows
      // entry with NULL damage/effectiveness (chk_move_index_required_for_attack
      // is satisfied because move_index is present).
      events.push({ type: 'skipped', playerId: action.playerId, reason: 'target_fainted' });
      moveRows.push(makeMoveRow(state, action, attacker, defender, null, null));
      continue;
    }

    const damage = calcularDaño({
      attackerType: attacker.type,
      defenderType: defender.type,
      moveIndex: action.moveIndex,
      effectivenessCache,
    });
    const effectiveness = getMultiplier(
      effectivenessCache,
      attacker.type,
      defender.type,
    );

    // PP cost: moves 1-3 only; move 4 has no PP column.
    if (action.moveIndex !== 4) {
      attacker[`pp_move_${action.moveIndex}`] -= 1;
    }

    // Damage, HP clamp at 0, faint bookkeeping.
    defender.current_hp = Math.max(0, defender.current_hp - damage);
    const fainted = defender.current_hp === 0;
    if (fainted) {
      defender.fainted = true;
      defender.is_active = false;
    }

    events.push({
      type: 'resolved',
      playerId: action.playerId,
      moveIndex: action.moveIndex,
      damage,
      effectiveness,
      fainted,
    });
    moveRows.push(
      makeMoveRow(state, action, attacker, defender, damage, effectiveness),
    );
  }

  // 4. KO detection / phase transition. A round is processed either way —
  //    even a both-rejected round advances the turn counter.
  const turnNumber = state.duel.turn_number ?? 1;
  state.duel.turn_number = turnNumber + 1;
  for (const row of moveRows) {
    row.turn_number = turnNumber;
  }

  let nextPhase;
  if (!hasNonFainted(state, player1_id)) {
    state.duel.status = 'finished';
    state.duel.winner_id = player2_id;
    state.duel.end_reason = 'ko';
    nextPhase = transition(PHASES.IN_PROGRESS, EVENTS.FINISH);
  } else if (!hasNonFainted(state, player2_id)) {
    state.duel.status = 'finished';
    state.duel.winner_id = player1_id;
    state.duel.end_reason = 'ko';
    nextPhase = transition(PHASES.IN_PROGRESS, EVENTS.FINISH);
  } else {
    nextPhase = transition(PHASES.IN_PROGRESS, EVENTS.ROUND_RESOLVED);
  }

  return { events, nextDuelState: state, moveRows, nextPhase };
}

/**
 * I/O orchestrator (Phase 3). Public engine entry point: takes ONLY ids and
 * pre-submitted actions — never a caller-supplied state object (ENG-04).
 *
 *   1. fetch canonical state via the repository (duel + pokemonStates, with
 *      `type` joined and turn_number computed)
 *   2. call the pure resolveRoundLogic core with the process-wide
 *      type-effectiveness cache
 *   3. persist the round atomically via applyRoundResult (one transaction:
 *      UPDATE duels + duel_pokemon_state, INSERT moves ×N — N excludes
 *      rejected actions)
 *   4. advance the in-memory 5-phase FSM for this duel
 *
 * Callers wrap this in `withDuelFaultIsolation(duelId, ...)` for per-duel
 * fault containment (genuine faults only — an insufficient_pp rejection is a
 * normal `rejected` event in the return value, never an exception).
 *
 * @param {number} duelId
 * @param {{ moveIndex: number, wasTimeout?: boolean }} accionP1 - P1's action
 * @param {{ moveIndex: number, wasTimeout?: boolean }} accionP2 - P2's action
 * @param {{ rng?: () => number }} [options] - injectable RNG (default Math.random)
 * @returns {Promise<{ events: object[], phase: string, winnerId?: number }>}
 * @throws {Error} when the duel does not exist or the cache is not loaded
 */
export async function resolverRonda(duelId, accionP1, accionP2, { rng = Math.random } = {}) {
  const state = await getDuelState(duelId);
  if (state === null) {
    throw new Error(`Duel ${duelId} not found`);
  }

  // Finished-phase guard (item #6): a stray timer/buffered action must never
  // re-resolve an already-ended duel. If the canonical status is not
  // `in_progress`, this is a safe no-op — no duel_pokemon_state mutation, no
  // moves row, no FSM transition (previously a stray call could silently
  // overwrite winner_id/end_reason or throw on an illegal transition()).
  if (state.duel.status !== 'in_progress') {
    return { applied: false };
  }

  const effectivenessCache = getEffectivenessCache();
  const { events, nextDuelState, moveRows, nextPhase } = resolveRoundLogic(
    state,
    accionP1,
    accionP2,
    { rng, effectivenessCache },
  );

  await applyRoundResult(duelId, nextDuelState, moveRows);
  getPhaseStore().set(duelId, nextPhase);

  return {
    events,
    phase: nextPhase,
    winnerId: nextDuelState.duel.winner_id ?? undefined,
  };
}
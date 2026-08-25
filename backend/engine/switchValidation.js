/**
 * Switch-decision validation (Phase 2 pure core + Phase 3 I/O wrapper).
 * Closes SECURITY-REPORT PL1-05: a player can only switch to their own, alive,
 * bench pokemon.
 *
 * Pure core: `validateSwitchDecisionCore(roster, playerId, targetPokemonId)` —
 * the roster is passed in (fake roster in unit tests).
 * I/O wrapper: `validateSwitchDecision(duelId, playerId, targetPokemonId)` —
 * fetches the player's roster via the repository and delegates to the core
 * (the design's ID-based public signature, ENG-04).
 *
 * Checks, in order: ownership -> not fainted -> not already active.
 * On failure a ValidationError carrying a machine-readable `reason` is thrown
 * ('wrong_owner' | 'fainted' | 'already_active') so the WS layer can map it to
 * a player-facing message.
 */
import { getPlayerRoster } from '../repositories/duelRepository.js';

/** Error thrown for an invalid switch decision; `reason` is machine-readable. */
export class ValidationError extends Error {
  constructor(reason, message) {
    super(`${reason}: ${message}`);
    this.name = 'ValidationError';
    this.reason = reason;
  }
}

/**
 * Pure core. @param {Array<{player_id: number, pokemon_id: number, fainted: boolean, is_active: boolean}>} roster
 *        the submitting player's `duel_pokemon_state` rows (a target outside
 *        the roster is a wrong_owner rejection)
 * @param {number} playerId
 * @param {number} targetPokemonId
 * @returns {true} when the switch is legal
 * @throws {ValidationError} with reason 'wrong_owner' | 'fainted' | 'already_active'
 */
export function validateSwitchDecisionCore(roster, playerId, targetPokemonId) {
  const target = roster.find((p) => p.pokemon_id === targetPokemonId);

  if (target === undefined || target.player_id !== playerId) {
    throw new ValidationError(
      'wrong_owner',
      `Pokemon ${targetPokemonId} is not in player ${playerId}'s roster`,
    );
  }
  if (target.fainted) {
    throw new ValidationError(
      'fainted',
      `Pokemon ${targetPokemonId} is fainted and cannot be switched in`,
    );
  }
  if (target.is_active) {
    throw new ValidationError(
      'already_active',
      `Pokemon ${targetPokemonId} is already on the field`,
    );
  }
  return true;
}

/**
 * I/O wrapper (Phase 3): the design's public ID-based signature. Fetches the
 * player's roster for the duel via the repository and delegates to the pure
 * core — canonical DB state is the only ground truth (ENG-04).
 *
 * @param {number} duelId
 * @param {number} playerId
 * @param {number} targetPokemonId
 * @returns {Promise<true>}
 * @throws {ValidationError} with reason 'wrong_owner' | 'fainted' | 'already_active'
 */
export async function validateSwitchDecision(duelId, playerId, targetPokemonId) {
  const roster = await getPlayerRoster(duelId, playerId);
  return validateSwitchDecisionCore(roster, playerId, targetPokemonId);
}

/**
 * Pure core for FIRST-ACTIVATION lead selection (item #5, F1). Distinct from
 * `validateSwitchDecisionCore`: a lead pick is the first active pokemon of the
 * duel, so there is no per-target `already_active` test and the pick is
 * pre-round setup, never journaled as a `switch` move. F1 adds a ROSTER-WIDE
 * `already_active` guard: if ANY row in the player's roster is already active,
 * the pick is rejected — a player can never hold more than one active pokemon
 * (closes the mid-duel bench-activation exploit). This fires before the
 * ownership/fainted checks, so a mid-duel bench pick is rejected even when the
 * target itself is a healthy, owned bench pokemon.
 *
 * Checks, in order: roster already has an active pokemon -> ownership -> not fainted.
 * @param {Array<{player_id: number, pokemon_id: number, fainted: boolean, is_active?: boolean}>} roster
 *        the submitting player's `duel_pokemon_state` rows
 * @param {number} playerId
 * @param {number} pokemonId
 * @returns {true} when the lead pick is legal
 * @throws {ValidationError} with reason 'already_active' | 'wrong_owner' | 'fainted'
 */
export function validateLeadSelectionCore(roster, playerId, pokemonId) {
  const target = roster.find((p) => p.pokemon_id === pokemonId);

  // F1: roster-wide guard. If the player already has an active pokemon anywhere
  // in their roster, a lead pick is always invalid — regardless of which pokemon
  // is targeted. Checked first so a mid-duel bench activation is rejected on
  // the spot rather than falling through to ownership/fainted.
  if (roster.some((p) => p.is_active === true)) {
    throw new ValidationError(
      'already_active',
      `Player ${playerId} already has an active pokemon`,
    );
  }

  if (target === undefined || target.player_id !== playerId) {
    throw new ValidationError(
      'wrong_owner',
      `Pokemon ${pokemonId} is not in player ${playerId}'s roster`,
    );
  }
  if (target.fainted) {
    throw new ValidationError(
      'fainted',
      `Pokemon ${pokemonId} is fainted and cannot lead`,
    );
  }
  return true;
}

/**
 * I/O wrapper for lead selection (ENG-04 ID-based signature): fetches the
 * player's roster via the repository and delegates to the pure core.
 *
 * @param {number} duelId
 * @param {number} playerId
 * @param {number} pokemonId
 * @returns {Promise<true>}
 * @throws {ValidationError} with reason 'already_active' | 'wrong_owner' | 'fainted'
 */
export async function validateLeadSelection(duelId, playerId, pokemonId) {
  const roster = await getPlayerRoster(duelId, playerId);
  return validateLeadSelectionCore(roster, playerId, pokemonId);
}
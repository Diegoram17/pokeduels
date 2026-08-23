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
import { MOVE_DAMAGE } from './constants.js';
import { getMultiplier } from './typeEffectiveness.js';

/**
 * Pure damage calculation: base move damage x type-effectiveness multiplier,
 * floored, with a hard minimum of 1 (a legal hit never deals 0).
 *
 * @param {object} params
 * @param {string} params.attackerType
 * @param {string} params.defenderType
 * @param {number} params.moveIndex - integer in 1..4
 * @param {Map<string, number>} params.effectivenessCache - see typeEffectiveness.js
 * @returns {number} damage >= 1
 * @throws {Error} when moveIndex is out of range or the type pair has no multiplier
 */
export function calcularDaño({
  attackerType,
  defenderType,
  moveIndex,
  effectivenessCache,
}) {
  const base = MOVE_DAMAGE[moveIndex];
  if (base === undefined) {
    throw new Error(`Unknown moveIndex ${moveIndex} — expected an integer in 1..4`);
  }
  const multiplier = getMultiplier(effectivenessCache, attackerType, defenderType);
  return Math.max(1, Math.floor(base * multiplier));
}
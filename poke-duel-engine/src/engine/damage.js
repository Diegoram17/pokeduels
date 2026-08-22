// src/engine/damage.js
import { HP_BASE, MOVES } from './constants.js';

/**
 * @param {string} attackingType
 * @param {string} defendingType
 * @param {TypeEffectiveness[]} typeChart
 * @returns {number}
 */
export function getEffectiveness(attackingType, defendingType, typeChart) {
  const entry = typeChart.find(
    (te) => te.attacking_type === attackingType && te.defending_type === defendingType
  );
  return entry ? entry.multiplier : 1.0;
}

/**
 * @param {string} attackingType
 * @param {string} defendingType
 * @param {number} moveIndex
 * @param {TypeEffectiveness[]} typeChart
 * @returns {number}
 */
export function calculateDamage(attackingType, defendingType, moveIndex, typeChart) {
  const move = MOVES[moveIndex];
  if (!move) return 0;
  
  const multiplier = getEffectiveness(attackingType, defendingType, typeChart);
  const rawDamage = Math.floor(move.damage * multiplier);
  return Math.max(1, rawDamage);
}
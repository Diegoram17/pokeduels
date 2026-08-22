// src/engine/constants.js
/**
 * @typedef {Object} MoveData
 * @property {number} damage
 * @property {number} pp
 */

/** @type {number} */
export const HP_BASE = 100;

/** @type {Record<number, MoveData>} */
export const MOVES = {
  1: { damage: 25, pp: 4 },
  2: { damage: 20, pp: 4 },
  3: { damage: 15, pp: 4 },
  4: { damage: 10, pp: Infinity },
};

/** @type {number} */
export const MAX_TEAM_SIZE = 6;

/** @type {number} */
export const INITIAL_PP = 4;
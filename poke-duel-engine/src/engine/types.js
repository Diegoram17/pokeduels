// src/engine/types.js
/**
 * @typedef {Object} PokemonInstance
 * @property {number} pokemonId
 * @property {string} name
 * @property {string} type
 * @property {number} currentHp
 * @property {Record<1|2|3, number>} pp
 * @property {boolean} fainted
 */

/**
 * @typedef {Object} PlayerDuelState
 * @property {string} playerId
 * @property {PokemonInstance[]} team
 * @property {number|null} activeIndex
 */

/**
 * @typedef {Object} DuelState
 * @property {string} duelId
 * @property {string} phase
 * @property {number} turnNumber
 * @property {Record<string, PlayerDuelState>} players
 * @property {Record<string, Action|null>} pendingActions
 * @property {Record<string, number|null>} pendingSwitches
 * @property {string|null} winnerId
 * @property {string|null} endReason
 */

/**
 * @typedef {Object} BattleEvent
 * @property {string} type
 * @property {string} playerId
 */

/**
 * @typedef {Object} AttackEvent
 * @property {string} type
 * @property {string} playerId
 * @property {number} moveIndex
 * @property {number} damage
 * @property {string} targetId
 * @property {number} targetHpAfter
 * @property {boolean} wasTimeout
 * @property {boolean} wasFallback
 */

/**
 * @typedef {Object} FaintEvent
 * @property {string} type
 * @property {string} playerId
 * @property {number} pokemonIndex
 */

/**
 * @typedef {Object} SwitchEvent
 * @property {string} type
 * @property {string} playerId
 * @property {number} fromIndex
 * @property {number} toIndex
 * @property {boolean} forced
 */

/**
 * @typedef {Object} TurnSkippedEvent
 * @property {string} type
 * @property {string} playerId
 * @property {string} reason
 */

/**
 * @typedef {Object} PpFallbackEvent
 * @property {string} type
 * @property {string} playerId
 * @property {number} attemptedMove
 * @property {number} fallbackMove
 */

/**
 * @typedef {Object} DuelEndEvent
 * @property {string} type
 * @property {string} winnerId
 * @property {string} reason
 */

/**
 * @typedef {Object} TournamentState
 * @property {string} tournamentId
 * @property {string} size
 * @property {string} phase
 * @property {Array<{round: string, duels: string[]}>} rounds
 * @property {Record<string, DuelState>} duels
 * @property {Record<string, string[]>} results
 * @property {string[]} eliminated
 */

/**
 * @typedef {Object} Action
 * @property {number} moveIndex
 * @property {boolean} isTimeout
 */

/**
 * @typedef {Object} TypeEffectiveness
 * @property {string} attacking_type
 * @property {string} defending_type
 * @property {number} multiplier
 */

/**
 * @callback RngFn
 * @returns {number}
 */

/**
 * @callback DamageFn
 * @param {string} attackingType
 * @param {string} defendingType
 * @param {number} moveIndex
 * @param {TypeEffectiveness[]} typeChart
 * @returns {number}
 */

export const PHASES = {
  AWAITING_LEAD: 'AWAITING_LEAD',
  AWAITING_SWITCH: 'AWAITING_SWITCH',
  AWAITING_ACTIONS: 'AWAITING_ACTIONS',
  FINISHED: 'FINISHED',
};
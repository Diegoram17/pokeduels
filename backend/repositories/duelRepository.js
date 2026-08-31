/**
 * Duel repository barrel (Phase 3, A2 split) — THE only public API for duel
 * persistence. External code imports duel functions from HERE and nowhere
 * else; the split internals (duelQueries / duelTransactions /
 * duelStateMapper) are private implementation modules.
 *
 * Explicit re-export list (NOT `export *`): a symbol collision would silently
 * drop a name, and an explicit list keeps the public surface greppable. The
 * exported surface is byte-identical to the pre-split monolithic
 * duelRepository.js — the ~20 import sites are untouched.
 *
 * - duelQueries.js      — read-only SELECTs (+ POKEMON_STATE_SELECT fragment)
 * - duelTransactions.js — every write + the withTransaction helper
 * - duelStateMapper.js  — pure mapDuelStateToCamelCase (no pg import)
 */
export {
  getDuelState,
  findActiveDuelForPlayer,
  findPendingBracketDuelForPlayer,
  getPlayerRoster,
} from './duelQueries.js';

export {
  applyRoundResult,
  createDuelFromRoom,
  applySwitchDecision,
  finishDuelWrite,
  markDuelInProgress,
  finishDuelByWalkover,
  activateLead,
  recordMove,
} from './duelTransactions.js';

export { mapDuelStateToCamelCase, mapRoundEventsToCamelCase } from './duelStateMapper.js';

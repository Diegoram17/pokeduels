/**
 * Duel engine constants — 1-indexed move slots, matching the shipped
 * `moves.move_index` CHECK (1..4) and the `duel_pokemon_state` PP columns.
 */

/** Base damage per move slot: {1:25, 2:20, 3:15, 4:10}. */
export const MOVE_DAMAGE = Object.freeze({ 1: 25, 2: 20, 3: 15, 4: 10 });

/**
 * PP cost per move slot. Move 4 carries no PP cost ("unlimited" per the
 * `moves` schema comment) and must never be rejected for insufficient PP.
 */
export const MOVE_PP = Object.freeze({ 1: 4, 2: 4, 3: 4, 4: Infinity });
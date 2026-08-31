/**
 * Pure duel-state mapping leaf (Phase 3, A2 split). Deliberately has NO
 * `pg`/pool import — this is the only repository module unit-tested without a
 * database connection (test/duelStateMapping.test.js imports it directly).
 *
 * Transforms the canonical snake_case repository state ({ duel, pokemonStates })
 * into the camelCase shape the frontend consumes — DuelState/DuelPokemonState
 * per frontend/src/state/schema.ts. `name`/`spriteUrl`/`backSpriteUrl` are NOT
 * part of the canonical state (they need extra pokemons joins) and are left
 * to the client wiring (#9/#10) to fill from its own catalog.
 *
 * @param {{ duel: object, pokemonStates: object[] }} duelState
 * @returns {{ duelId: number, turnNumber: number, winnerId: number|null,
 *             endReason: string|null, pokemonStates: object[] }}
 */
export function mapDuelStateToCamelCase({ duel, pokemonStates }) {
  return {
    duelId: duel.id,
    turnNumber: duel.turn_number,
    winnerId: duel.winner_id ?? null,
    endReason: duel.end_reason ?? null,
    pokemonStates: pokemonStates.map((p) => ({
      duelId: p.duel_id,
      ownerId: p.player_id,
      pokemonId: p.pokemon_id,
      type: p.type,
      currentHp: p.current_hp,
      ppMove1: p.pp_move_1,
      ppMove2: p.pp_move_2,
      ppMove3: p.pp_move_3,
      isActive: p.is_active,
      fainted: p.fainted,
    })),
  };
}

/**
 * Pure mapping helper (Fase 7, PR7): turns the round engine's ordered `events`
 * list (backend/engine/roundResolver.js — { resolved, skipped, rejected })
 * into the additive `turnEvents` field of the `duel:turn_resolved` payload,
 * preserving the exact server resolution order. `skipped`/`rejected` events
 * only carry what the engine emitted, so the absent numeric fields default to
 * null (the frontend AttackEvent schema uses `null` for "no value").
 *
 * @param {Array<{ type: string, playerId: number, moveIndex?: number,
 *                 damage?: number, effectiveness?: number, fainted?: boolean,
 *                 reason?: string }>|undefined} events - resolverRonda's
 *        events, or undefined/null on the no-op path ({ applied:false })
 * @returns {Array<{ type: string, playerId: number, moveIndex: number|null,
 *                   damage: number|null, effectiveness: number|null,
 *                   fainted: boolean, reason: string|null }>}
 */
export function mapRoundEventsToCamelCase(events) {
  if (!Array.isArray(events)) return [];
  return events.map((event) => ({
    type: event.type,
    playerId: event.playerId,
    moveIndex: event.moveIndex ?? null,
    damage: event.damage ?? null,
    effectiveness: event.effectiveness ?? null,
    fainted: event.fainted ?? false,
    reason: event.reason ?? null,
  }));
}
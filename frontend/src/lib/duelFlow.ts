import type { DuelPokemonState, MockState, TournamentSlot, TournamentState } from '../state/schema'
import { advanceQueue } from '../engine/tournamentQueue'

// Duel-flow helpers: which pokemon is on the field for each side, plus the
// tournament routing decisions taken when a duel finishes. The mock engine
// marks a fainted pokemon with isActive: false, so "active" means the
// currently deployed unit (undefined when a side is awaiting a switch).

export function humanActivePokemon(state: MockState): DuelPokemonState | undefined {
  const { duelPokemonState, player } = state
  return duelPokemonState.find((p) => p.ownerId === player.nickname && p.isActive)
}

export function rivalActivePokemon(state: MockState): DuelPokemonState | undefined {
  const { duelPokemonState, player } = state
  return duelPokemonState.find((p) => p.ownerId !== player.nickname && p.isActive)
}

/** The losing owner of the current finished duel (single source of truth, also used by the state reducer). */
export function slotLoserId(state: MockState): string | null {
  const { duel, duelPokemonState } = state
  if (!duel || !duel.winnerId) return null
  return duelPokemonState.find((p) => p.ownerId !== duel.winnerId)?.ownerId ?? null
}

/**
 * Simulates recording the current finished duel's result into the tournament
 * and advancing the queue — the exact transition the reducer performs on
 * `advanceTournament()`. Used by the finish effect to decide routing without
 * waiting for the dispatch to land.
 */
export function tournamentAfterCurrentDuel(state: MockState): TournamentState | null {
  const { tournament, duel } = state
  if (!tournament || !duel || duel.phase !== 'finished' || !duel.winnerId) return null
  const slot = duel.slot as TournamentSlot
  const loser = slotLoserId(state)
  if (!loser) return null
  return advanceQueue({
    ...tournament,
    results: { ...tournament.results, [slot]: { winner: duel.winnerId, loser } },
  })
}

export type PostDuelRoute = { path: '/wait-room' } | { path: '/ranking' }

/**
 * Where a finished duel sends the player next: the wait room whenever the
 * tournament still has slots to play (each slot reuses the wait-room → duel →
 * swap cycle), the ranking screen when every slot is done, and the ranking
 * screen directly for a 1v1 duel.
 */
export function computePostDuelRoute(state: MockState): PostDuelRoute | null {
  const { duel, room } = state
  if (!duel || duel.phase !== 'finished') return null
  if (room?.mode !== 'tournament') return { path: '/ranking' }
  const next = tournamentAfterCurrentDuel(state)
  if (!next) return null
  const allDone = next.queue.every((slot) => next.results[slot] != null)
  return allDone ? { path: '/ranking' } : { path: '/wait-room' }
}
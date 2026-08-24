import type { DuelPokemonState, MockState } from '../state/schema'
import { roomMode } from './rooms'

// Duel-flow helpers (#10 PR 2): which pokemon is on the field for each side,
// plus the server-driven routing decision taken when a duel finishes. Pokemon
// identity is numeric (server-issued ids), so the player side is matched by
// Number(player.playerId) — never by nickname.

export function humanActivePokemon(state: MockState): DuelPokemonState | undefined {
  const { duelPokemonState, player } = state
  const ownerId = Number(player.playerId)
  return duelPokemonState.find((p) => p.ownerId === ownerId && p.isActive)
}

export function rivalActivePokemon(state: MockState): DuelPokemonState | undefined {
  const { duelPokemonState, player } = state
  const ownerId = Number(player.playerId)
  return duelPokemonState.find((p) => p.ownerId !== ownerId && p.isActive)
}

export type PostDuelRoute = { path: '/wait-room' } | { path: '/ranking' }

/**
 * Where a finished duel sends the player next (server-driven, design data flow):
 * - 1v1            → wait-room, where the PostDuelRematchPanel offers re-ready.
 * - bracket + final ranking in → ranking screen (authoritative podium).
 * - bracket + no final ranking → null — stay on the board and render the
 *   wait/go-now choice; room:final_ranking later flips this to '/ranking'.
 */
export function computePostDuelRoute(state: MockState): PostDuelRoute | null {
  const { duel, room, finalRanking } = state
  if (!duel || duel.phase !== 'finished') return null
  if (!room || roomMode(room.maxPlayers) !== 'tournament') return { path: '/wait-room' }
  return finalRanking != null ? { path: '/ranking' } : null
}
import type { DuelPokemonState, MockState } from '../state/schema'

// Duel-flow helpers: which pokemon is on the field for each side. The mock
// engine marks a fainted pokemon with isActive: false, so "active" means the
// currently deployed unit (undefined when a side is awaiting a switch).

export function humanActivePokemon(state: MockState): DuelPokemonState | undefined {
  const { duelPokemonState, player } = state
  return duelPokemonState.find((p) => p.ownerId === player.nickname && p.isActive)
}

export function rivalActivePokemon(state: MockState): DuelPokemonState | undefined {
  const { duelPokemonState, player } = state
  return duelPokemonState.find((p) => p.ownerId !== player.nickname && p.isActive)
}
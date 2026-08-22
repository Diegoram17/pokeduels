import { describe, it, expect } from 'vitest'
import { humanActivePokemon, rivalActivePokemon } from '../duelFlow'
import type { DuelPokemonState, MockState } from '../../state/schema'

const NICKNAME = 'Ash'

function makePokemon(
  ownerId: string,
  pokemonId: string,
  isActive: boolean,
  fainted = false,
): DuelPokemonState {
  return {
    duelId: 'duel-1',
    ownerId,
    pokemonId,
    name: pokemonId,
    type: 'normal',
    currentHp: isActive ? 100 : 0,
    ppMove1: 4,
    ppMove2: 4,
    ppMove3: 4,
    isActive,
    fainted,
  }
}

function makeState(roster: DuelPokemonState[]): MockState {
  return {
    player: { nickname: NICKNAME },
    room: null,
    teamSelection: { starterId: 'pikachu', rosterIds: [] },
    tournament: null,
    duelPokemonState: roster,
    duel: null,
  }
}

describe('humanActivePokemon', () => {
  it('returns the pokemon owned by the player with isActive set', () => {
    const state = makeState([
      makePokemon(NICKNAME, 'pikachu', true),
      makePokemon('bot', 'rattata', true),
    ])
    expect(humanActivePokemon(state)?.pokemonId).toBe('pikachu')
  })

  it('returns undefined when the player has no active pokemon (after a KO)', () => {
    const state = makeState([
      makePokemon(NICKNAME, 'pikachu', false, true),
      makePokemon(NICKNAME, 'bulbasaur', false),
      makePokemon('bot', 'rattata', true),
    ])
    expect(humanActivePokemon(state)).toBeUndefined()
  })
})

describe('rivalActivePokemon', () => {
  it('returns the active pokemon owned by the opponent', () => {
    const state = makeState([
      makePokemon(NICKNAME, 'pikachu', true),
      makePokemon('bot', 'rattata', true),
    ])
    expect(rivalActivePokemon(state)?.pokemonId).toBe('rattata')
  })

  it('returns undefined when the opponent has no active pokemon', () => {
    const state = makeState([
      makePokemon(NICKNAME, 'pikachu', true),
      makePokemon('bot', 'rattata', false, true),
    ])
    expect(rivalActivePokemon(state)).toBeUndefined()
  })
})
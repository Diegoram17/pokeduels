import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolveTurn } from '../turnResolution'
import type { DuelPokemonState, DuelState, MockState } from '../../state/schema'

const NICKNAME = 'Ash'

function makePokemon(
  duelId: string,
  ownerId: string,
  pokemonId: string,
  currentHp: number,
  isActive: boolean,
  fainted = false,
): DuelPokemonState {
  return {
    duelId,
    ownerId,
    pokemonId,
    name: pokemonId,
    type: 'normal',
    spriteUrl: '',
    backSpriteUrl: '',
    currentHp,
    ppMove1: 4,
    ppMove2: 4,
    ppMove3: 4,
    isActive,
    fainted,
  }
}

function makeDuel(phase: DuelState['phase'] = 'awaiting_actions'): DuelState {
  return {
    duelId: 'duel-1',
    slot: '1v1',
    phase,
    turnNumber: 1,
    winnerId: null,
    endReason: null,
  }
}

function makeState(
  humanHp: number,
  botHp: number,
  humanBench: DuelPokemonState[] = [],
  botBench: DuelPokemonState[] = [],
): MockState {
  const duelId = 'duel-1'
  const humanActive = makePokemon(duelId, NICKNAME, 'pikachu', humanHp, true)
  const botActive = makePokemon(duelId, 'bot', 'rattata', botHp, true)
  return {
    player: { nickname: NICKNAME },
    room: null,
    teamSelection: { starterId: 'pikachu', rosterIds: [] },
    tournament: null,
    duelPokemonState: [
      humanActive,
      botActive,
      ...humanBench,
      ...botBench,
    ],
    duel: makeDuel(),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveTurn', () => {
  it('applies human damage to the opponent active pokemon', () => {
    const state = makeState(100, 100)
    const result = resolveTurn(0, state)

    const botActive = result.duelPokemonState.find(
      (p) => p.ownerId === 'bot' && p.isActive,
    )
    expect(botActive?.currentHp).toBe(75)
  })

  it('bot responds with damage to the human active pokemon', () => {
    // Force bot move 0 (25% damage) for determinism.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const state = makeState(100, 100)
    const result = resolveTurn(0, state)

    const humanActive = result.duelPokemonState.find(
      (p) => p.ownerId === NICKNAME && p.isActive,
    )
    expect(humanActive?.currentHp).toBe(75)
  })

  it('increments turnNumber', () => {
    const state = makeState(100, 100)
    const result = resolveTurn(0, state)
    expect(result.duel.turnNumber).toBe(2)
  })

  it('marks the bot active fainted when human attack drops it to 0', () => {
    const state = makeState(100, 25)
    const result = resolveTurn(0, state)

    const botActive = result.duelPokemonState.find(
      (p) => p.ownerId === 'bot' && p.pokemonId === 'rattata',
    )
    expect(botActive?.currentHp).toBe(0)
    expect(botActive?.fainted).toBe(true)
    expect(botActive?.isActive).toBe(false)
  })

  it('auto-swaps a bot bench pokemon in when the bot active faints', () => {
    const botBench = [
      makePokemon('duel-1', 'bot', 'pidgey', 100, false),
    ]
    const state = makeState(100, 25, [], botBench)
    const result = resolveTurn(0, state)

    const newBotActive = result.duelPokemonState.find(
      (p) => p.ownerId === 'bot' && p.isActive,
    )
    expect(newBotActive?.pokemonId).toBe('pidgey')
    expect(newBotActive?.currentHp).toBe(100)

    // Duel still in progress — human won the exchange but not the duel.
    expect(result.duel.phase).toBe('awaiting_actions')
    expect(result.duel.winnerId).toBeNull()
  })

  it('ends the duel with the human as winner when the bot has no bench', () => {
    const state = makeState(100, 25)
    const result = resolveTurn(0, state)

    expect(result.duel.phase).toBe('finished')
    expect(result.duel.winnerId).toBe(NICKNAME)
    expect(result.duel.endReason).toBe('ko')
  })

  it('sets phase to awaiting_switch when the human active faints and a bench exists', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // bot move 0 = 25 damage
    const humanBench = [
      makePokemon('duel-1', NICKNAME, 'bulbasaur', 100, false),
    ]
    const state = makeState(10, 100, humanBench)
    const result = resolveTurn(0, state)

    const humanActive = result.duelPokemonState.find(
      (p) => p.ownerId === NICKNAME && p.pokemonId === 'pikachu',
    )
    expect(humanActive?.fainted).toBe(true)
    expect(result.duel.phase).toBe('awaiting_switch')
    expect(result.duel.winnerId).toBeNull()
  })

  it('ends the duel with the bot as winner when the human has no bench', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // bot move 0 = 25 damage
    const state = makeState(10, 100)
    const result = resolveTurn(0, state)

    expect(result.duel.phase).toBe('finished')
    expect(result.duel.winnerId).toBe('bot')
    expect(result.duel.endReason).toBe('ko')
  })

  it('does not mutate the input state (returns new arrays)', () => {
    const state = makeState(100, 100)
    const result = resolveTurn(0, state)

    expect(result.duelPokemonState).not.toBe(state.duelPokemonState)
    expect(result.duel).not.toBe(state.duel)
    // Original state untouched.
    const originalBot = state.duelPokemonState.find(
      (p) => p.ownerId === 'bot' && p.isActive,
    )
    expect(originalBot?.currentHp).toBe(100)
  })
})
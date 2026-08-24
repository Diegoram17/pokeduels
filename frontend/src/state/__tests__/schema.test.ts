// Schema contract tests (#10 PR 1): the client state schema is reshaped from
// the local mock-engine model (queue/activeSlot/results, string identities)
// to the server-driven projection model (bracket-only tournament, numeric
// pokemon identity, pendingDuelId / finalRanking pointers).
//
// Type assertions are static guards (enforced by tsc / vitest --typecheck);
// the runtime assertions exercise createInitialState, the canonical MockState
// factory, so the RED is observable under plain `vitest run`.

import { describe, it, expect } from 'vitest'
import { expectTypeOf } from 'vitest'
import { createInitialState } from '../store'
import type {
  BracketPairing,
  DuelPhase,
  DuelPokemonState,
  MockState,
  RankingEntry,
  TournamentSlot,
  TournamentState,
} from '../schema'

describe('TournamentState projection shape', () => {
  it('bracket holds slot-keyed pairings with duelId, playerA and playerB', () => {
    const tournament: TournamentState = {
      bracket: {
        semiA: { duelId: '42', playerA: '10', playerB: '11' },
        semiB: null,
      },
    }
    expect(Object.keys(tournament)).toEqual(['bracket'])
    expect(tournament.bracket.semiA).toEqual({ duelId: '42', playerA: '10', playerB: '11' })
    expect(tournament.bracket.semiB).toBeNull()
  })

  it('drops the mock-engine queue/activeSlot/results fields', () => {
    expectTypeOf<TournamentState>().not.toHaveProperty('queue')
    expectTypeOf<TournamentState>().not.toHaveProperty('activeSlot')
    expectTypeOf<TournamentState>().not.toHaveProperty('results')
  })

  it('pairings are keyed by the four tournament slots', () => {
    const slot: TournamentSlot = 'final'
    const pairing: BracketPairing = { duelId: '99', playerA: '10', playerB: '11' }
    const bracket: Partial<Record<TournamentSlot, BracketPairing | null>> = { [slot]: pairing }
    expect(bracket.final).toEqual(pairing)
    expectTypeOf<TournamentSlot>().toEqualTypeOf<
      'semiA' | 'semiB' | 'thirdPlace' | 'final'
    >()
  })
})

describe('DuelPhase', () => {
  it('includes the lead_selection phase', () => {
    expectTypeOf<DuelPhase>().toEqualTypeOf<
      'lead_selection' | 'awaiting_actions' | 'awaiting_switch' | 'finished'
    >()
  })
})

describe('DuelPokemonState numeric identity', () => {
  it('identifies owner and pokemon by server-issued numbers', () => {
    expectTypeOf<DuelPokemonState['ownerId']>().toBeNumber()
    expectTypeOf<DuelPokemonState['pokemonId']>().toBeNumber()
    const pokemon: DuelPokemonState = {
      duelId: '42',
      ownerId: 10,
      pokemonId: 25,
      name: 'Pikachu',
      type: 'electric',
      spriteUrl: 'front',
      backSpriteUrl: 'back',
      currentHp: 100,
      ppMove1: 4,
      ppMove2: 4,
      ppMove3: 4,
      isActive: true,
      fainted: false,
    }
    expect(pokemon.ownerId).toBe(10)
    expect(pokemon.pokemonId).toBe(25)
  })
})

describe('MockState server-driven pointers', () => {
  it('starts with no pending duel and no final ranking', () => {
    const s = createInitialState()
    expect(s.pendingDuelId).toBeNull()
    expect(s.finalRanking).toBeNull()
  })

  it('types pendingDuelId as string|null and finalRanking as RankingEntry[]|null', () => {
    expectTypeOf<MockState['pendingDuelId']>().toEqualTypeOf<string | null>()
    expectTypeOf<MockState['finalRanking']>().toEqualTypeOf<RankingEntry[] | null>()
    const withRanking: MockState = {
      ...createInitialState(),
      pendingDuelId: '42',
      finalRanking: [{ rank: 1, name: 'Ash', champion: true }],
    }
    expect(withRanking.pendingDuelId).toBe('42')
    expect(withRanking.finalRanking?.[0]).toEqual({ rank: 1, name: 'Ash', champion: true })
  })
})
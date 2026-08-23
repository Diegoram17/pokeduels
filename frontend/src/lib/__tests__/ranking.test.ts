import { describe, it, expect } from 'vitest'
import { buildRanking } from '../ranking'
import type { DuelPokemonState, DuelState, MockState, TournamentState } from '../../state/schema'

const NICKNAME = 'Ash'

function makePokemon(ownerId: string, isActive: boolean): DuelPokemonState {
  return {
    duelId: 'duel-1',
    ownerId,
    pokemonId: `${ownerId}-1`,
    name: `${ownerId}-1`,
    type: 'normal',
    spriteUrl: '',
    backSpriteUrl: '',
    currentHp: isActive ? 100 : 0,
    ppMove1: 4,
    ppMove2: 4,
    ppMove3: 4,
    isActive,
    fainted: !isActive,
  }
}

function makeDuel(winnerId: string | null): DuelState {
  return {
    duelId: 'duel-1',
    slot: '1v1',
    phase: winnerId ? 'finished' : 'awaiting_actions',
    turnNumber: 3,
    winnerId,
    endReason: winnerId ? 'ko' : null,
  }
}

function makeTournament(overrides: Partial<TournamentState> = {}): TournamentState {
  return {
    bracket: {},
    queue: ['semiA', 'semiB', 'thirdPlace', 'final'],
    activeSlot: 'final',
    results: {},
    ...overrides,
  }
}

function make1v1State(winnerId: string | null): MockState {
  return {
    player: { nickname: NICKNAME, playerId: null, sessionToken: null },
    room: { code: 'AB12', mode: '1v1', maxPlayers: 2, status: 'finished', players: [NICKNAME] },
    teamSelection: { starterId: 25, rosterIds: [] },
    tournament: null,
    duelPokemonState: [makePokemon(NICKNAME, true), makePokemon('bot', true)],
    duel: makeDuel(winnerId),
  }
}

const FULL_TOURNAMENT_RESULTS = {
  semiA: { winner: 'VORTEX_99', loser: 'CYBER_RONIN' },
  semiB: { winner: NICKNAME, loser: 'STEALTH_OP' },
  thirdPlace: { winner: 'CYBER_RONIN', loser: 'STEALTH_OP' },
  final: { winner: NICKNAME, loser: 'VORTEX_99' },
}

function makeTournamentState(results: TournamentState['results']): MockState {
  return {
    player: { nickname: NICKNAME, playerId: null, sessionToken: null },
    room: {
      code: 'AB12',
      mode: 'tournament',
      maxPlayers: 4,
      status: 'finished',
      players: [NICKNAME],
    },
    teamSelection: { starterId: 25, rosterIds: [] },
    tournament: makeTournament({ results }),
    duelPokemonState: [makePokemon(NICKNAME, true), makePokemon('bot', true)],
    duel: makeDuel(NICKNAME),
  }
}

describe('buildRanking — 1v1', () => {
  it('places the real duel winner first and the loser second', () => {
    const state = make1v1State(NICKNAME)
    const ranking = buildRanking(state)
    expect(ranking).toEqual([
      { rank: 1, name: NICKNAME, champion: true },
      { rank: 2, name: 'bot', champion: false },
    ])
  })

  it('places the bot first when the bot won the duel', () => {
    const state = make1v1State('bot')
    const ranking = buildRanking(state)
    expect(ranking[0]).toEqual({ rank: 1, name: 'bot', champion: true })
    expect(ranking[1]).toEqual({ rank: 2, name: NICKNAME, champion: false })
  })

  it('returns no rows while the 1v1 duel has not finished', () => {
    expect(buildRanking(make1v1State(null))).toEqual([])
  })

  it('returns no rows without a room', () => {
    const state = make1v1State(NICKNAME)
    state.room = null
    expect(buildRanking(state)).toEqual([])
  })
})

describe('buildRanking — tournament', () => {
  it('orders the podium as final winner, final loser, 3rd-place winner, 3rd-place loser', () => {
    const ranking = buildRanking(makeTournamentState(FULL_TOURNAMENT_RESULTS))
    expect(ranking).toEqual([
      { rank: 1, name: NICKNAME, champion: true },
      { rank: 2, name: 'VORTEX_99', champion: false },
      { rank: 3, name: 'CYBER_RONIN', champion: false },
      { rank: 4, name: 'STEALTH_OP', champion: false },
    ])
  })

  it('shows exactly four rows for a completed tournament', () => {
    const ranking = buildRanking(makeTournamentState(FULL_TOURNAMENT_RESULTS))
    expect(ranking).toHaveLength(4)
  })

  it('returns no rows while the 3rd-place duel or the final is pending', () => {
    const state = makeTournamentState({
      semiA: FULL_TOURNAMENT_RESULTS.semiA,
      semiB: FULL_TOURNAMENT_RESULTS.semiB,
    })
    expect(buildRanking(state)).toEqual([])
  })
})
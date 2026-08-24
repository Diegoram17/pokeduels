import { describe, it, expect } from 'vitest'
import { buildRanking, buildProvisionalRanking } from '../ranking'
import type { DuelPokemonState, DuelState, MockState, TournamentState } from '../../state/schema'

// #10 PR 2: ranking is server-driven. buildRanking returns the authoritative
// rows pushed via room:final_ranking verbatim; buildProvisionalRanking is the
// local wait-vs-go-now fallback built from the bracket projection + the
// finished duel result while the room has not closed yet.

function makePokemon(ownerId: number, pokemonId: number, isActive = true): DuelPokemonState {
  return {
    duelId: '42',
    ownerId,
    pokemonId,
    name: `mon-${pokemonId}`,
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
    duelId: '42',
    slot: 'semiA',
    phase: winnerId ? 'finished' : 'awaiting_actions',
    turnNumber: 3,
    winnerId,
    endReason: winnerId ? 'ko' : null,
    opponentDisconnected: false,
    lastRejection: null,
  }
}

function makeRoom() {
  return {
    code: 'AB12',
    maxPlayers: 4 as const,
    status: 'in_progress' as const,
    players: [
      { playerId: '10', nickname: 'Ash', ready: true, connected: true },
      { playerId: '11', nickname: 'Misty', ready: true, connected: true },
      { playerId: '12', nickname: 'Brock', ready: true, connected: true },
      { playerId: '13', nickname: 'Gary', ready: true, connected: true },
    ],
  }
}

function makeTournament(overrides: Partial<TournamentState> = {}): TournamentState {
  return {
    bracket: {
      semiA: { duelId: '42', playerA: '10', playerB: '11' },
      semiB: { duelId: '43', playerA: '12', playerB: '13' },
    },
    ...overrides,
  }
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
    room: makeRoom(),
    teamSelection: { starterId: 25, rosterIds: [] },
    tournament: makeTournament(),
    duelPokemonState: [makePokemon(10, 25), makePokemon(11, 5)],
    duel: makeDuel('10'),
    pendingDuelId: null,
    finalRanking: null,
    ...overrides,
  }
}

describe('buildRanking — server-driven', () => {
  it('returns the authoritative rows from state.finalRanking verbatim', () => {
    const finalRanking = [
      { rank: 1, name: 'Ash', champion: true },
      { rank: 2, name: 'Misty', champion: false },
      { rank: 3, name: 'Brock', champion: false },
      { rank: 4, name: 'Gary', champion: false },
    ]
    const state = makeState({ finalRanking })
    expect(buildRanking(state)).toEqual(finalRanking)
  })

  it('returns no rows while room:final_ranking has not arrived', () => {
    expect(buildRanking(makeState())).toEqual([])
  })

  it('never synthesizes a podium locally once finalRanking is null (server owns ranking)', () => {
    // A finished duel + full bracket are present, but buildRanking must NOT
    // derive rows from them — only the provisional builder may.
    const state = makeState({ duel: makeDuel('10'), finalRanking: null })
    expect(buildRanking(state)).toEqual([])
  })
})

describe('buildProvisionalRanking — bracket + finished duel fallback', () => {
  it('builds a podium from the bracket and the finished duel: winner 1st, loser 2nd, other bracket players after', () => {
    const state = makeState()
    expect(buildProvisionalRanking(state)).toEqual([
      { rank: 1, name: 'Ash', champion: true },
      { rank: 2, name: 'Misty', champion: false },
      { rank: 3, name: 'Brock', champion: false },
      { rank: 4, name: 'Gary', champion: false },
    ])
  })

  it('marks the opponent as champion when the player lost their duel', () => {
    const state = makeState({ duel: makeDuel('11') })
    const ranking = buildProvisionalRanking(state)
    expect(ranking[0]).toEqual({ rank: 1, name: 'Misty', champion: true })
    expect(ranking[1]).toEqual({ rank: 2, name: 'Ash', champion: false })
    expect(ranking).toHaveLength(4)
  })

  it('returns no rows while the duel is still in progress', () => {
    const state = makeState({ duel: makeDuel(null) })
    expect(buildProvisionalRanking(state)).toEqual([])
  })

  it('returns no rows outside a tournament (1v1 has no bracket)', () => {
    const state = makeState({ tournament: null, duel: { ...makeDuel('10'), slot: '1v1' } })
    expect(buildProvisionalRanking(state)).toEqual([])
  })
})
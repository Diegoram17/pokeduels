import { describe, it, expect } from 'vitest'
import { computePostDuelRoute, humanActivePokemon, rivalActivePokemon } from '../duelFlow'
import type { DuelPokemonState, DuelState, MockState, TournamentState } from '../../state/schema'

// #10 PR 2: duel-flow helpers are server-driven. ownerId is the numeric
// server-issued player id (compare against Number(player.playerId)); the
// finished-duel routing follows the design data flow (1v1 -> wait-room rematch,
// bracket+finalRanking -> ranking, bracket+noFinalRanking -> stay/choice).

const PLAYER_ID = '10'

function makePokemon(
  ownerId: number,
  pokemonId: number,
  isActive: boolean,
  fainted = false,
): DuelPokemonState {
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
    fainted,
  }
}

function makeDuel(
  slot: DuelState['slot'],
  phase: DuelState['phase'],
  winnerId: string | null,
): DuelState {
  return {
    duelId: `duel-${slot}`,
    slot,
    phase,
    turnNumber: 1,
    winnerId,
    endReason: phase === 'finished' ? 'ko' : null,
    opponentDisconnected: false,
    lastRejection: null,
  }
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    player: { nickname: 'Ash', playerId: PLAYER_ID, sessionToken: 'token-1' },
    room: null,
    teamSelection: { starterId: 25, rosterIds: [] },
    tournament: null,
    duelPokemonState: [],
    duel: null,
    pendingDuelId: null,
    finalRanking: null,
    roomAborted: null,
    ...overrides,
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

describe('humanActivePokemon — numeric ownerId', () => {
  it('returns the active pokemon whose ownerId matches the numeric player id', () => {
    const state = makeState({
      player: { nickname: 'Ash', playerId: PLAYER_ID, sessionToken: 'token-1' },
      duelPokemonState: [makePokemon(10, 25, true), makePokemon(11, 5, true)],
    })
    expect(humanActivePokemon(state)?.pokemonId).toBe(25)
  })

  it('returns undefined when the player has no active pokemon (after a KO)', () => {
    const state = makeState({
      player: { nickname: 'Ash', playerId: PLAYER_ID, sessionToken: 'token-1' },
      duelPokemonState: [
        makePokemon(10, 25, false, true),
        makePokemon(10, 5, false),
        makePokemon(11, 6, true),
      ],
    })
    expect(humanActivePokemon(state)).toBeUndefined()
  })
})

describe('rivalActivePokemon — numeric ownerId', () => {
  it('returns the active pokemon owned by a different numeric id', () => {
    const state = makeState({
      player: { nickname: 'Ash', playerId: PLAYER_ID, sessionToken: 'token-1' },
      duelPokemonState: [makePokemon(10, 25, true), makePokemon(11, 5, true)],
    })
    expect(rivalActivePokemon(state)?.pokemonId).toBe(5)
  })

  it('returns undefined when the opponent has no active pokemon (lead not yet pushed)', () => {
    // PR 1 contract: the opponent lead is unknown until the first
    // duel:turn_resolved — the helper must simply return undefined.
    const state = makeState({
      player: { nickname: 'Ash', playerId: PLAYER_ID, sessionToken: 'token-1' },
      duelPokemonState: [makePokemon(10, 25, true), makePokemon(11, 5, false)],
    })
    expect(rivalActivePokemon(state)).toBeUndefined()
  })
})

describe('computePostDuelRoute — server-driven finish routing', () => {
  it('returns null while the duel is in progress', () => {
    const state = makeState({
      room: { code: 'AB12', maxPlayers: 4, status: 'in_progress', players: [] },
      tournament: makeTournament(),
      duelPokemonState: [makePokemon(10, 25, true), makePokemon(11, 5, true)],
      duel: makeDuel('semiA', 'awaiting_actions', null),
    })
    expect(computePostDuelRoute(state)).toBeNull()
  })

  it('routes a finished 1v1 duel to the wait room (rematch panel, not ranking)', () => {
    const state = makeState({
      room: { code: 'AB12', maxPlayers: 2, status: 'in_progress', players: [] },
      duelPokemonState: [makePokemon(10, 25, true), makePokemon(11, 5, true)],
      duel: makeDuel('1v1', 'finished', '10'),
    })
    expect(computePostDuelRoute(state)).toEqual({ path: '/wait-room' })
  })

  it('routes a finished bracket duel to the ranking screen when the final ranking is in', () => {
    const state = makeState({
      room: { code: 'AB12', maxPlayers: 4, status: 'in_progress', players: [] },
      tournament: makeTournament(),
      duelPokemonState: [makePokemon(10, 25, true), makePokemon(11, 5, true)],
      duel: makeDuel('semiA', 'finished', '10'),
      finalRanking: [{ rank: 1, name: 'Ash', champion: true }],
    })
    expect(computePostDuelRoute(state)).toEqual({ path: '/ranking' })
  })

  it('stays (null) after a bracket duel when the room has not closed yet — wait/go-now choice', () => {
    const state = makeState({
      room: { code: 'AB12', maxPlayers: 4, status: 'in_progress', players: [] },
      tournament: makeTournament(),
      duelPokemonState: [makePokemon(10, 25, true), makePokemon(11, 5, true)],
      duel: makeDuel('semiA', 'finished', '10'),
      finalRanking: null,
    })
    expect(computePostDuelRoute(state)).toBeNull()
  })
})
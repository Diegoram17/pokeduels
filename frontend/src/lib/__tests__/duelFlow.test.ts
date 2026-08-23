import { describe, it, expect } from 'vitest'
import {
  computePostDuelRoute,
  humanActivePokemon,
  rivalActivePokemon,
  slotLoserId,
  tournamentAfterCurrentDuel,
} from '../duelFlow'
import type {
  DuelPokemonState,
  DuelState,
  MockState,
  TournamentSlot,
  TournamentState,
} from '../../state/schema'

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

function makeState(roster: DuelPokemonState[]): MockState {
  return {
    player: { nickname: NICKNAME, playerId: null, sessionToken: null },
    room: null,
    teamSelection: { starterId: 25, rosterIds: [] },
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

// ---------------------------------------------------------------------------
// Tournament routing fixtures
// ---------------------------------------------------------------------------

function makeDuel(slot: DuelState['slot'], phase: DuelState['phase'], winnerId: string | null): DuelState {
  return {
    duelId: `duel-${slot}`,
    slot,
    phase,
    turnNumber: 1,
    winnerId,
    endReason: phase === 'finished' ? 'surrender' : null,
  }
}

function makeTournament(
  overrides: Partial<TournamentState> = {},
): TournamentState {
  return {
    bracket: {},
    queue: ['semiA', 'semiB'],
    activeSlot: 'semiA',
    results: {},
    ...overrides,
  }
}

function makeTournamentState(
  duelSlot: DuelState['slot'],
  duelPhase: DuelState['phase'],
  winnerId: string | null,
  tournament: TournamentState,
): MockState {
  return {
    player: { nickname: NICKNAME, playerId: null, sessionToken: null },
    room: {
      code: 'AB12',
      maxPlayers: 4,
      status: 'in_progress',
      players: [{ playerId: 'p1', nickname: NICKNAME, ready: false, connected: true }],
    },
    teamSelection: { starterId: 25, rosterIds: [] },
    tournament,
    duelPokemonState: [
      makePokemon(NICKNAME, 'pikachu', true),
      makePokemon('bot', 'rattata', true),
    ],
    duel: makeDuel(duelSlot, duelPhase, winnerId),
  }
}

const QUEUE_FULL: TournamentSlot[] = ['semiA', 'semiB', 'thirdPlace', 'final']

describe('slotLoserId', () => {
  it('returns the bot as the loser when the human won the duel', () => {
    const state = makeTournamentState('1v1', 'finished', NICKNAME, makeTournament())
    expect(slotLoserId(state)).toBe('bot')
  })

  it('returns the human as the loser when the bot won the duel', () => {
    const state = makeTournamentState('1v1', 'finished', 'bot', makeTournament())
    expect(slotLoserId(state)).toBe(NICKNAME)
  })

  it('returns null while the duel is still in progress', () => {
    const state = makeTournamentState('1v1', 'awaiting_actions', null, makeTournament())
    expect(slotLoserId(state)).toBeNull()
  })
})

describe('tournamentAfterCurrentDuel', () => {
  it('records the semiA result and moves the active slot to semiB', () => {
    const state = makeTournamentState('semiA', 'finished', NICKNAME, makeTournament())
    const next = tournamentAfterCurrentDuel(state)
    expect(next?.results.semiA).toEqual({ winner: NICKNAME, loser: 'bot' })
    expect(next?.activeSlot).toBe('semiB')
    expect(next?.queue).toEqual(['semiA', 'semiB'])
  })

  it('appends the 3rd-place and final slots once both semifinals resolve', () => {
    const state = makeTournamentState(
      'semiB',
      'finished',
      NICKNAME,
      makeTournament({
        queue: ['semiA', 'semiB'],
        activeSlot: 'semiB',
        results: { semiA: { winner: NICKNAME, loser: 'bot' } },
      }),
    )
    const next = tournamentAfterCurrentDuel(state)
    expect(next?.queue).toEqual(['semiA', 'semiB', 'thirdPlace', 'final'])
    expect(next?.activeSlot).toBe('thirdPlace')
  })

  it('moves to the final after the 3rd-place duel concludes', () => {
    const state = makeTournamentState(
      'thirdPlace',
      'finished',
      'bot',
      makeTournament({
        queue: QUEUE_FULL,
        activeSlot: 'thirdPlace',
        results: {
          semiA: { winner: NICKNAME, loser: 'bot' },
          semiB: { winner: NICKNAME, loser: 'bot' },
        },
      }),
    )
    const next = tournamentAfterCurrentDuel(state)
    expect(next?.results.thirdPlace).toEqual({ winner: 'bot', loser: NICKNAME })
    expect(next?.activeSlot).toBe('final')
  })

  it('settles on the final once every slot has a result', () => {
    const state = makeTournamentState(
      'final',
      'finished',
      NICKNAME,
      makeTournament({
        queue: QUEUE_FULL,
        activeSlot: 'final',
        results: {
          semiA: { winner: NICKNAME, loser: 'bot' },
          semiB: { winner: NICKNAME, loser: 'bot' },
          thirdPlace: { winner: 'bot', loser: NICKNAME },
        },
      }),
    )
    const next = tournamentAfterCurrentDuel(state)
    expect(next?.results.final).toEqual({ winner: NICKNAME, loser: 'bot' })
    expect(next?.activeSlot).toBe('final')
    for (const slot of QUEUE_FULL) {
      expect(next?.results[slot]).toBeDefined()
    }
  })

  it('returns null when the duel is not finished', () => {
    const state = makeTournamentState('semiA', 'awaiting_actions', null, makeTournament())
    expect(tournamentAfterCurrentDuel(state)).toBeNull()
  })
})

describe('computePostDuelRoute', () => {
  it('returns null while the duel is in progress', () => {
    const state = makeTournamentState('semiA', 'awaiting_actions', null, makeTournament())
    expect(computePostDuelRoute(state)).toBeNull()
  })

  it('routes a finished 1v1 duel straight to the ranking screen', () => {
    const state: MockState = {
      ...makeTournamentState('1v1', 'finished', NICKNAME, makeTournament()),
      room: {
        code: 'AB12',
        maxPlayers: 2,
        status: 'finished',
        players: [{ playerId: 'p1', nickname: NICKNAME, ready: false, connected: true }],
      },
      tournament: null,
    }
    expect(computePostDuelRoute(state)).toEqual({ path: '/ranking' })
  })

  it('routes back to the wait room while tournament slots remain', () => {
    const state = makeTournamentState('semiA', 'finished', NICKNAME, makeTournament())
    expect(computePostDuelRoute(state)).toEqual({ path: '/wait-room' })
  })

  it('routes to the ranking screen when the last tournament slot concludes', () => {
    const state = makeTournamentState(
      'final',
      'finished',
      NICKNAME,
      makeTournament({
        queue: QUEUE_FULL,
        activeSlot: 'final',
        results: {
          semiA: { winner: NICKNAME, loser: 'bot' },
          semiB: { winner: NICKNAME, loser: 'bot' },
          thirdPlace: { winner: 'bot', loser: NICKNAME },
        },
      }),
    )
    expect(computePostDuelRoute(state)).toEqual({ path: '/ranking' })
  })
})
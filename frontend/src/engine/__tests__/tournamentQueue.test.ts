import { describe, it, expect } from 'vitest'
import { advanceQueue } from '../tournamentQueue'
import type { TournamentState, TournamentSlot } from '../../state/schema'

function makeTournament(
  queue: TournamentSlot[],
  results: TournamentState['results'] = {},
): TournamentState {
  return {
    bracket: { semiA: null, semiB: null },
    queue,
    activeSlot: queue[0] ?? 'semiA',
    results,
  }
}

describe('advanceQueue', () => {
  it('keeps semiA active when no results exist yet', () => {
    const t = makeTournament(['semiA', 'semiB'])
    const next = advanceQueue(t)
    expect(next.activeSlot).toBe('semiA')
    expect(next.queue).toEqual(['semiA', 'semiB'])
  })

  it('advances to semiB once semiA has a result', () => {
    const t = makeTournament(['semiA', 'semiB'], {
      semiA: { winner: 'Ash', loser: 'Bot 2' },
    })
    const next = advanceQueue(t)
    expect(next.activeSlot).toBe('semiB')
  })

  it('appends thirdPlace and final once both semis resolve, activeSlot thirdPlace', () => {
    const t = makeTournament(['semiA', 'semiB'], {
      semiA: { winner: 'Ash', loser: 'Bot 2' },
      semiB: { winner: 'Bot 3', loser: 'Bot 4' },
    })
    const next = advanceQueue(t)
    expect(next.queue).toEqual(['semiA', 'semiB', 'thirdPlace', 'final'])
    expect(next.activeSlot).toBe('thirdPlace')
  })

  it('advances to final once thirdPlace resolves', () => {
    const t = makeTournament(
      ['semiA', 'semiB', 'thirdPlace', 'final'],
      {
        semiA: { winner: 'Ash', loser: 'Bot 2' },
        semiB: { winner: 'Bot 3', loser: 'Bot 4' },
        thirdPlace: { winner: 'Bot 2', loser: 'Bot 4' },
      },
    )
    const next = advanceQueue(t)
    expect(next.activeSlot).toBe('final')
  })

  it('keeps final active once all four slots have results (tournament done)', () => {
    const t = makeTournament(
      ['semiA', 'semiB', 'thirdPlace', 'final'],
      {
        semiA: { winner: 'Ash', loser: 'Bot 2' },
        semiB: { winner: 'Bot 3', loser: 'Bot 4' },
        thirdPlace: { winner: 'Bot 2', loser: 'Bot 4' },
        final: { winner: 'Ash', loser: 'Bot 3' },
      },
    )
    const next = advanceQueue(t)
    expect(next.activeSlot).toBe('final')
    expect(next.queue).toEqual(['semiA', 'semiB', 'thirdPlace', 'final'])
  })

  it('does not duplicate thirdPlace/final when called repeatedly after semis resolve', () => {
    const t = makeTournament(['semiA', 'semiB'], {
      semiA: { winner: 'Ash', loser: 'Bot 2' },
      semiB: { winner: 'Bot 3', loser: 'Bot 4' },
    })
    const once = advanceQueue(t)
    const twice = advanceQueue(once)
    expect(twice.queue).toEqual(['semiA', 'semiB', 'thirdPlace', 'final'])
  })
})
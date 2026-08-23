// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import { STORAGE_KEY, serializeMockState } from '../../state/store'
import type { DuelPokemonState, DuelState, MockState, TournamentState } from '../../state/schema'
import RankingScreen from '../RankingScreen'

function SessionProbe() {
  const [state] = useMockState()
  return (
    <span data-testid="session-probe">
      room:{state.room ? 'present' : 'cleared'}|nickname:{state.player.nickname}
    </span>
  )
}

function renderRanking(state: MockState) {
  localStorage.setItem(STORAGE_KEY, serializeMockState(state))
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/ranking']}>
        <SessionProbe />
        <Routes>
          <Route path="/ranking" element={<RankingScreen />} />
          <Route path="/lobby" element={<div>LOBBY-LANDED</div>} />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

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

function makeFinishedDuel(winnerId: string): DuelState {
  return {
    duelId: 'duel-1',
    slot: '1v1',
    phase: 'finished',
    turnNumber: 3,
    winnerId,
    endReason: 'ko',
  }
}

function make1v1FinishedState(): MockState {
  return {
    player: { nickname: 'Ash', playerId: null, sessionToken: null },
    room: { code: 'AB12', mode: '1v1', maxPlayers: 2, status: 'finished', players: ['Ash'] },
    teamSelection: { starterId: 25, rosterIds: [] },
    tournament: null,
    duelPokemonState: [makePokemon('Ash', true), makePokemon('bot', true)],
    duel: makeFinishedDuel('Ash'),
  }
}

function makeTournamentFinishedState(): MockState {
  const results = {
    semiA: { winner: 'VORTEX_99', loser: 'CYBER_RONIN' },
    semiB: { winner: 'Ash', loser: 'STEALTH_OP' },
    thirdPlace: { winner: 'CYBER_RONIN', loser: 'STEALTH_OP' },
    final: { winner: 'Ash', loser: 'VORTEX_99' },
  }
  const tournament: TournamentState = {
    bracket: {},
    queue: ['semiA', 'semiB', 'thirdPlace', 'final'],
    activeSlot: 'final',
    results,
  }
  return {
    player: { nickname: 'Ash', playerId: null, sessionToken: null },
    room: {
      code: 'AB12',
      mode: 'tournament',
      maxPlayers: 4,
      status: 'finished',
      players: ['Ash'],
    },
    teamSelection: { starterId: 25, rosterIds: [] },
    tournament,
    duelPokemonState: [makePokemon('Ash', true), makePokemon('bot', true)],
    duel: makeFinishedDuel('Ash'),
  }
}

describe('RankingScreen — 1v1 podium', () => {
  it('shows exactly two rows with the real winner first and a champion badge', () => {
    renderRanking(make1v1FinishedState())

    const rows = screen.getAllByTestId('podium-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('#1')
    expect(rows[0]).toHaveTextContent('ASH')
    expect(rows[0]).toHaveTextContent('CAMPEÓN')
    expect(rows[1]).toHaveTextContent('#2')
    expect(rows[1]).not.toHaveTextContent('CAMPEÓN')
  })

  it('does not show a 4th row for a 1v1 result', () => {
    renderRanking(make1v1FinishedState())
    expect(screen.queryByText('#4')).not.toBeInTheDocument()
  })
})

describe('RankingScreen — tournament podium', () => {
  it('shows four rows ordered final winner, final loser, 3rd winner, 3rd loser', () => {
    renderRanking(makeTournamentFinishedState())

    const rows = screen.getAllByTestId('podium-row')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('#1')
    expect(rows[0]).toHaveTextContent('ASH')
    expect(rows[1]).toHaveTextContent('#2')
    expect(rows[1]).toHaveTextContent('VORTEX_99')
    expect(rows[2]).toHaveTextContent('#3')
    expect(rows[2]).toHaveTextContent('CYBER_RONIN')
    expect(rows[3]).toHaveTextContent('#4')
    expect(rows[3]).toHaveTextContent('STEALTH_OP')
  })

  it('shows the 4th-place row only for tournaments', () => {
    renderRanking(makeTournamentFinishedState())
    expect(screen.getByText('#4')).toBeInTheDocument()
  })
})

describe('RankingScreen — play again', () => {
  it('clears the room, duel and tournament while keeping the nickname', async () => {
    const user = userEvent.setup()
    renderRanking(makeTournamentFinishedState())

    await user.click(screen.getByRole('button', { name: /jugar de nuevo/i }))

    expect(screen.getByText('LOBBY-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('session-probe').textContent).toContain('room:cleared')
    expect(screen.getByTestId('session-probe').textContent).toContain('nickname:Ash')
  })
})
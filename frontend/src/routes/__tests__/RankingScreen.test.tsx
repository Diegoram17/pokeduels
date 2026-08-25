// @vitest-environment jsdom
// #10 PR 2: RankingScreen is server-driven — it renders state.finalRanking
// verbatim, falls back to buildProvisionalRanking while the room is open, and
// silently swaps when room:final_ranking arrives (no badge/animation).
// "JUGAR DE NUEVO" stays a local reset + /lobby navigation.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import { STORAGE_KEY, serializeMockState } from '../../state/store'
import type { DuelPokemonState, DuelState, MockState, TournamentState } from '../../state/schema'
import RankingScreen from '../RankingScreen'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { disconnectSocket } from '../../lib/socket'

function makeFakeSocket(): Socket & { _fire: (event: string, payload?: unknown) => void } {
  const handlers = new Map<string, (payload?: unknown) => void>()
  const fake = {
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler)
      return fake
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event)
      return fake
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    _fire: (event: string, payload?: unknown) => {
      handlers.get(event)?.(payload)
    },
  }
  return fake as unknown as Socket & { _fire: (event: string, payload?: unknown) => void }
}

let fakeSocket: ReturnType<typeof makeFakeSocket>

function SessionProbe() {
  const [state] = useMockState()
  return (
    <span data-testid="session-probe">
      room:{state.room ? 'present' : 'cleared'}|nickname:{state.player.nickname}
    </span>
  )
}

function makePokemon(ownerId: number, isActive: boolean): DuelPokemonState {
  return {
    duelId: '42',
    ownerId,
    pokemonId: ownerId * 10 + 1,
    name: `mon-${ownerId}`,
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
    duelId: '42',
    slot: 'semiA',
    phase: 'finished',
    turnNumber: 3,
    winnerId,
    endReason: 'ko',
    opponentDisconnected: false,
    lastRejection: null,
  }
}

function makeTournamentState(): TournamentState {
  return {
    bracket: {
      semiA: { duelId: '42', playerA: '10', playerB: '11' },
      semiB: { duelId: '43', playerA: '12', playerB: '13' },
    },
  }
}

function makeRankingState(overrides: Partial<MockState> = {}): MockState {
  return {
    player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
    room: {
      code: 'AB12',
      maxPlayers: 4,
      status: 'in_progress',
      players: [
        { playerId: '10', nickname: 'Ash', ready: true, connected: true },
        { playerId: '11', nickname: 'Misty', ready: true, connected: true },
        { playerId: '12', nickname: 'Brock', ready: true, connected: true },
        { playerId: '13', nickname: 'Gary', ready: true, connected: true },
      ],
    },
    teamSelection: { starterId: 25, rosterIds: [] },
    tournament: makeTournamentState(),
    duelPokemonState: [makePokemon(10, true), makePokemon(11, true)],
    duel: makeFinishedDuel('10'),
    pendingDuelId: null,
    finalRanking: null,
    roomAborted: null,
    ...overrides,
  }
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

beforeEach(() => {
  fakeSocket = makeFakeSocket()
  vi.mocked(io).mockReturnValue(fakeSocket as never)
})

afterEach(() => {
  vi.clearAllMocks()
  disconnectSocket()
})

const FINAL_RANKING = [
  { rank: 1, name: 'Ash', champion: true },
  { rank: 2, name: 'Misty', champion: false },
  { rank: 3, name: 'Brock', champion: false },
  { rank: 4, name: 'Gary', champion: false },
]

describe('RankingScreen — authoritative ranking', () => {
  it('renders the podium from state.finalRanking verbatim', () => {
    renderRanking(makeRankingState({ finalRanking: FINAL_RANKING }))

    const rows = screen.getAllByTestId('podium-row')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('#1')
    expect(rows[0]).toHaveTextContent('ASH')
    expect(rows[0]).toHaveTextContent('CAMPEÓN')
    expect(rows[3]).toHaveTextContent('#4')
    expect(rows[3]).toHaveTextContent('GARY')
  })
})

describe('RankingScreen — provisional ranking (wait/go-now path)', () => {
  it('falls back to a provisional podium when finalRanking is still null', () => {
    renderRanking(makeRankingState())

    const rows = screen.getAllByTestId('podium-row')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('#1')
    expect(rows[0]).toHaveTextContent('ASH')
    expect(rows[0]).toHaveTextContent('CAMPEÓN')
    expect(rows[1]).toHaveTextContent('MISTY')
    expect(rows[2]).toHaveTextContent('BROCK')
    expect(rows[3]).toHaveTextContent('GARY')
  })

  it('silently swaps to the authoritative ranking when room:final_ranking arrives — no badge or message', () => {
    renderRanking(makeRankingState())

    expect(screen.getAllByTestId('podium-row')[0]).toHaveTextContent('ASH')
    // The provisional view carries no distinguishing marker.
    expect(screen.queryByText(/provisional/i)).not.toBeInTheDocument()

    act(() => {
      fakeSocket._fire('room:final_ranking', {
        roomId: 1,
        ranking: [
          { playerId: 11, nickname: 'Misty', finalRank: 1 },
          { playerId: 10, nickname: 'Ash', finalRank: 2 },
          { playerId: 12, nickname: 'Brock', finalRank: 3 },
          { playerId: 13, nickname: 'Gary', finalRank: 4 },
        ],
      })
    })

    const rows = screen.getAllByTestId('podium-row')
    expect(rows[0]).toHaveTextContent('MISTY')
    expect(rows[0]).toHaveTextContent('CAMPEÓN')
    expect(rows[1]).toHaveTextContent('ASH')
    // Silent swap: still no badge, animation or message.
    expect(screen.queryByText(/provisional/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/actualizado/i)).not.toBeInTheDocument()
  })
})

describe('RankingScreen — play again', () => {
  it('clears the room, duel and tournament while keeping the nickname', async () => {
    renderRanking(makeRankingState({ finalRanking: FINAL_RANKING }))

    act(() => {
      screen.getByRole('button', { name: /jugar de nuevo/i }).click()
    })

    expect(screen.getByText('LOBBY-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('session-probe').textContent).toContain('room:cleared')
    expect(screen.getByTestId('session-probe').textContent).toContain('nickname:Ash')
  })
})
// @vitest-environment jsdom
// #10 PR 2 integration tests for WaitRoomScreen: the 1v1 PostDuelRematchPanel
// (outcome + REVANCHA emitting room:ready + SALIR), the EnterDuelButton keyed
// on pendingDuelId (duel:start announces a new duel -> duel:join), and the real
// bracket rendered from tournament:bracket broadcasts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { STORAGE_KEY, serializeMockState } from '../../state/store'
import type { DuelState, MockState, RoomState } from '../../state/schema'
import WaitRoomScreen from '../WaitRoomScreen'
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

function makeRoom(maxPlayers: 2 | 4): RoomState {
  const players = [
    { playerId: '10', nickname: 'Ash', ready: false, connected: true },
    { playerId: '11', nickname: 'Misty', ready: false, connected: true },
    { playerId: '12', nickname: 'Brock', ready: false, connected: true },
    { playerId: '13', nickname: 'Gary', ready: false, connected: true },
  ]
  return {
    code: 'AB12',
    maxPlayers,
    status: 'in_progress',
    players: players.slice(0, maxPlayers),
  }
}

function makeFinished1v1Duel(winnerId: string): DuelState {
  return {
    duelId: '42',
    slot: '1v1',
    phase: 'finished',
    turnNumber: 3,
    winnerId,
    endReason: 'ko',
    opponentDisconnected: false,
    lastRejection: null,
  }
}

function renderWaitRoom(state: MockState) {
  localStorage.setItem(STORAGE_KEY, serializeMockState(state))
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/wait-room']}>
        <Routes>
          <Route path="/wait-room" element={<WaitRoomScreen />} />
          <Route
            path="/duel"
            element={
              <>
                <div>DUEL-LANDED</div>
              </>
            }
          />
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

describe('WaitRoomScreen — 1v1 PostDuelRematchPanel', () => {
  it('shows the outcome with re-ready and leave options after a 1v1 finish', () => {
    renderWaitRoom({
      player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
      room: makeRoom(2),
      teamSelection: { starterId: 25, rosterIds: [] },
      tournament: null,
      duelPokemonState: [],
      duel: makeFinished1v1Duel('10'),
      pendingDuelId: null,
      finalRanking: null,
      roomAborted: null,
    })

    expect(screen.getByText('¡GANASTE EL DUELO!')).toBeInTheDocument()
    const panel = screen.getByTestId('rematch-panel')
    expect(within(panel).getByRole('button', { name: /revancha/i })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /salir/i })).toBeInTheDocument()
  })

  it('marks the duel as lost when the opponent won', () => {
    renderWaitRoom({
      player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
      room: makeRoom(2),
      teamSelection: { starterId: 25, rosterIds: [] },
      tournament: null,
      duelPokemonState: [],
      duel: makeFinished1v1Duel('11'),
      pendingDuelId: null,
      finalRanking: null,
      roomAborted: null,
    })

    expect(screen.getByText('PERDISTE EL DUELO')).toBeInTheDocument()
  })

  it('REVANCHA emits room:ready; a new duel:start hides the panel and ENTRAR AL COMBATE joins via duel:join', async () => {
    renderWaitRoom({
      player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
      room: makeRoom(2),
      teamSelection: { starterId: 25, rosterIds: [] },
      tournament: null,
      duelPokemonState: [],
      duel: makeFinished1v1Duel('10'),
      pendingDuelId: null,
      finalRanking: null,
      roomAborted: null,
    })

    act(() => {
      screen.getByRole('button', { name: /revancha/i }).click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('room:ready', { ready: true })

    // Both seats re-ready -> the server bootstraps a new duel via duel:start.
    act(() => {
      fakeSocket._fire('duel:start', { duelId: 99 })
    })
    expect(screen.queryByText('¡GANASTE EL DUELO!')).not.toBeInTheDocument()
    const enterButton = screen.getByRole('button', { name: /entrar al combate/i })
    expect(enterButton).toBeInTheDocument()

    // Clicking joins the duel WITHOUT navigating yet (race-condition fix: the
    // screen must not bounce to /duel before duel:state has actually landed,
    // otherwise DuelBoardScreen redirects straight back to /wait-room).
    act(() => {
      enterButton.click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:join', { duelId: 99 })
    expect(screen.queryByText('DUEL-LANDED')).not.toBeInTheDocument()

    // Once the server resolves the join with duel:state, the player is routed
    // into the duel with state ready to render.
    act(() => {
      fakeSocket._fire('duel:state', {
        duelId: 99,
        turnNumber: 1,
        winnerId: null,
        endReason: null,
        pokemonStates: [
          { duelId: 99, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
          { duelId: 99, ownerId: 11, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
        ],
      })
    })
    expect(screen.getByText('DUEL-LANDED')).toBeInTheDocument()
  })

  it('leaves the room to the lobby when the player chooses SALIR', async () => {
    renderWaitRoom({
      player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
      room: makeRoom(2),
      teamSelection: { starterId: 25, rosterIds: [] },
      tournament: null,
      duelPokemonState: [],
      duel: makeFinished1v1Duel('10'),
      pendingDuelId: null,
      finalRanking: null,
      roomAborted: null,
    })

    act(() => {
      within(screen.getByTestId('rematch-panel'))
        .getByRole('button', { name: /salir/i })
        .click()
    })
    expect(screen.getByText('LOBBY-LANDED')).toBeInTheDocument()
  })
})

describe('WaitRoomScreen — ENTRAR AL COMBATE gate', () => {
  function baseWaitState(): MockState {
    return {
      player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
      room: makeRoom(2),
      teamSelection: { starterId: 25, rosterIds: [] },
      tournament: null,
      duelPokemonState: [],
      duel: null,
      pendingDuelId: null,
      finalRanking: null,
      roomAborted: null,
    }
  }

  it('shows ENTRAR AL COMBATE from the start, disabled until the server announces a duel', () => {
    renderWaitRoom(baseWaitState())

    const btn = screen.getByRole('button', { name: /entrar al combate/i })
    expect(btn).toBeInTheDocument()
    expect(btn).toBeDisabled()
  })

  it('enables ENTRAR AL COMBATE once duel:start announces a duel', () => {
    renderWaitRoom(baseWaitState())

    act(() => {
      fakeSocket._fire('duel:start', { duelId: 77 })
    })

    expect(screen.getByRole('button', { name: /entrar al combate/i })).toBeEnabled()
  })
})

describe('WaitRoomScreen — real bracket', () => {
  it('renders the bracket slots from tournament:bracket broadcasts with roster names', () => {
    renderWaitRoom({
      player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
      room: makeRoom(4),
      teamSelection: { starterId: 25, rosterIds: [] },
      tournament: null,
      duelPokemonState: [],
      duel: null,
      pendingDuelId: null,
      finalRanking: null,
      roomAborted: null,
    })

    act(() => {
      fakeSocket._fire('tournament:bracket', {
        roomId: 1,
        bracket: {
          semiA: { duelId: 42, playerA: 10, playerB: 11 },
          semiB: { duelId: 43, playerA: 12, playerB: 13 },
        },
      })
    })

    const bracket = screen.getByRole('region', { name: /cuadro/i })
    expect(within(bracket).getByText('SEMIFINAL A')).toBeInTheDocument()
    expect(within(bracket).getByText('Ash')).toBeInTheDocument()
    expect(within(bracket).getByText('Misty')).toBeInTheDocument()
    expect(within(bracket).getByText('Brock')).toBeInTheDocument()
    expect(within(bracket).getByText('Gary')).toBeInTheDocument()
    // Final/3rd slots are not broadcast yet — each renders playerA/playerB as TBD.
    expect(within(bracket).getAllByText('TBD')).toHaveLength(4)
  })

  it('labels the live tournament slot from the current duel (SEMIFINAL A)', () => {
    renderWaitRoom({
      player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
      room: makeRoom(4),
      teamSelection: { starterId: 25, rosterIds: [] },
      tournament: null,
      duelPokemonState: [],
      duel: null,
      pendingDuelId: null,
      finalRanking: null,
      roomAborted: null,
    })

    act(() => {
      fakeSocket._fire('tournament:bracket', {
        roomId: 1,
        bracket: { semiA: { duelId: 42, playerA: 10, playerB: 11 } },
      })
      fakeSocket._fire('duel:start', { duelId: 42 })
      fakeSocket._fire('duel:state', {
        duelId: 42,
        turnNumber: 1,
        winnerId: null,
        endReason: null,
        pokemonStates: [
          { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
          { duelId: 42, ownerId: 11, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
        ],
      })
    })

    expect(screen.getByTestId('slot-label')).toHaveTextContent('SEMIFINAL A')
  })
})
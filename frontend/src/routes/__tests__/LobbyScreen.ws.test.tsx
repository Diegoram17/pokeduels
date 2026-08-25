// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import LobbyScreen from '../LobbyScreen'
import { setSessionToken } from '../../lib/api'
import { STORAGE_KEY, serializeMockState } from '../../state/store'
import type { MockState } from '../../state/schema'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { disconnectSocket } from '../../lib/socket'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

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

function RoomProbe() {
  const [state] = useMockState()
  return (
    <div data-testid="room-probe">
      <span data-testid="probe-roster">
        {state.room?.players.map((p) => `${p.nickname}:${p.ready ? 'ready' : 'waiting'}`).join(',') ?? 'no-room'}
      </span>
    </div>
  )
}

function renderLobby(session?: boolean) {
  if (session) {
    const seeded: MockState = {
      player: { nickname: 'Ash', playerId: 'p1', sessionToken: 'token-1' },
      room: null,
      teamSelection: { starterId: null, rosterIds: [] },
      tournament: null,
      duelPokemonState: [],
      duel: null,
      pendingDuelId: null,
      finalRanking: null,
      roomAborted: null,
    }
    localStorage.setItem(STORAGE_KEY, serializeMockState(seeded))
  }
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/lobby']}>
        <Routes>
          <Route
            path="/lobby"
            element={
              <>
                <RoomProbe />
                <LobbyScreen />
              </>
            }
          />
          <Route path="/team-select" element={<div>TEAM-SELECT-LANDED</div>} />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

beforeEach(() => {
  setSessionToken('token-1')
  fakeSocket = makeFakeSocket()
  vi.mocked(io).mockReturnValue(fakeSocket as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setSessionToken(null)
  disconnectSocket()
  vi.clearAllMocks()
})

describe('LobbyScreen WS', () => {
  it('emits room:join with the code after a successful REST join', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 'r1', code: 'AB12', max_players: 2, status: 'waiting' }),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderLobby(true)
    await screen.findByText('SALAS DE BATALLA')

    await user.type(screen.getByPlaceholderText(/código de sala/i), 'ab12')
    await user.click(screen.getByRole('button', { name: /unirse/i }))

    await waitFor(() => {
      expect(fakeSocket.emit).toHaveBeenCalledWith('room:join', { code: 'AB12' })
    })
    expect(screen.getByText('TEAM-SELECT-LANDED')).toBeInTheDocument()
  })

  it('renders the live roster from the WS room:state payload', async () => {
    // Seed a session so the provider connects and subscribes to room:state.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])))
    renderLobby(true)
    await waitFor(() => {
      expect(fakeSocket.on).toHaveBeenCalledWith('room:state', expect.any(Function))
    })

    fakeSocket._fire('room:state', {
      roomId: 1,
      code: 'AB12',
      status: 'waiting',
      maxPlayers: 2,
      players: [
        { playerId: 'p1', nickname: 'Ash', ready: false, connected: true },
        { playerId: 'p2', nickname: 'Misty', ready: true, connected: true },
      ],
      startersTaken: [],
    })

    await waitFor(() => {
      expect(screen.getByTestId('probe-roster').textContent).toBe('Ash:waiting,Misty:ready')
    })
  })

  it('shows a generic disconnect banner (no countdown) and clears it on reconnect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])))
    renderLobby(true)
    await waitFor(() => {
      expect(fakeSocket.on).toHaveBeenCalledWith('room:state', expect.any(Function))
    })

    fakeSocket._fire('disconnect')

    expect(await screen.findByRole('alert')).toHaveTextContent(/conexión/i)
    expect(screen.queryByText(/60|segundo|countdown/i)).not.toBeInTheDocument()

    fakeSocket._fire('connect')
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('shows an inline banner via connect_error with manual retry only, no auto-redirect or countdown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])))
    renderLobby(true)
    await waitFor(() => {
      expect(fakeSocket.on).toHaveBeenCalledWith('room:state', expect.any(Function))
    })

    fakeSocket._fire('connect_error')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/conectar|conexión/i)
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
    expect(screen.queryByText(/60|segundo|countdown/i)).not.toBeInTheDocument()
    // No auto-redirect: stays on the lobby screen.
    expect(screen.getByText('SALAS DE BATALLA')).toBeInTheDocument()

    fakeSocket._fire('connect')
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
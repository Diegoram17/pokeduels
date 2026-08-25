// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockStateProvider } from '../MockStateProvider'
import { useMockState } from '../useMockState'
import { createInitialState, serializeMockState, STORAGE_KEY } from '../store'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { disconnectSocket } from '../../lib/socket'

function makeFakeSocket(): Socket & { _fire: (event: string, payload?: unknown) => void } {
  const handlers = new Map<string, (payload?: unknown) => void>()
  const fakeSocketRef: Socket & { _fire: (event: string, payload?: unknown) => void } = {
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler)
      return fakeSocketRef
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event)
      return fakeSocketRef
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    // test helper: fire a server event through the registered handlers
    _fire: (event: string, payload?: unknown) => {
      handlers.get(event)?.(payload)
    },
  } as unknown as Socket & { _fire: (event: string, payload?: unknown) => void }
  return fakeSocketRef
}

let fakeSocket: ReturnType<typeof makeFakeSocket>

function SessionProbe() {
  const [state, actions] = useMockState()
  return (
    <div>
      <span data-testid="token">{state.player.sessionToken ?? 'none'}</span>
      <span data-testid="player-id">{state.player.playerId ?? 'none'}</span>
      <span data-testid="roster">
        {state.room?.players.map((p) => p.nickname).join(',') ?? 'no-room'}
      </span>
      <span data-testid="roster-ids">
        {state.room?.players.map((p) => p.playerId).join(',') ?? 'no-room'}
      </span>
      <button
        type="button"
        onClick={() =>
          actions.sessionEstablished({
            playerId: 'p1',
            sessionToken: 'token-1',
            nickname: 'Ash',
          })
        }
      >
        establish
      </button>
      <button
        type="button"
        onClick={() =>
          actions.sessionEstablished({
            // The backend serializes Postgres ids as numbers at runtime; the
            // provider must normalize them to the schema's string form.
            playerId: 10 as unknown as string,
            sessionToken: 'token-1',
            nickname: 'Ash',
          })
        }
      >
        establishNumeric
      </button>
      <button type="button" onClick={() => actions.resetSession()}>
        reset
      </button>
    </div>
  )
}

function renderProvider() {
  return render(
    <MockStateProvider>
      <MemoryRouter>
        <SessionProbe />
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

describe('MockStateProvider socket lifecycle', () => {
  it('connects the socket with the session token after sessionEstablished', () => {
    renderProvider()
    expect(io).not.toHaveBeenCalled()

    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })

    expect(io).toHaveBeenCalledTimes(1)
    const [, opts] = vi.mocked(io).mock.calls[0]
    expect((opts as { auth: { sessionToken: string } }).auth.sessionToken).toBe('token-1')
  })

  it('subscribes to room:state and dispatches the enriched roster into state', () => {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })

    expect(fakeSocket.on).toHaveBeenCalledWith('room:state', expect.any(Function))

    act(() => {
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
    })

    expect(screen.getByTestId('roster').textContent).toBe('Ash,Misty')
  })

  it('stringifies numeric player ids from room:state (Postgres int -> schema string)', () => {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })

    act(() => {
      fakeSocket._fire('room:state', {
        roomId: 1,
        code: 'AB12',
        status: 'waiting',
        maxPlayers: 2,
        players: [
          { playerId: 10, nickname: 'Ash', ready: false, connected: true },
          { playerId: 11, nickname: 'Misty', ready: true, connected: true },
        ],
        startersTaken: [],
      })
    })

    expect(screen.getByTestId('roster-ids').textContent).toBe('10,11')
  })

  it('stringifies the numeric player id from sessionEstablished', () => {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establishNumeric' }).click()
    })

    expect(screen.getByTestId('player-id').textContent).toBe('10')
  })

  it('disconnects the socket on resetSession', () => {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })
    expect(fakeSocket.disconnect).not.toHaveBeenCalled()

    act(() => {
      screen.getByRole('button', { name: 'reset' }).click()
    })

    expect(fakeSocket.disconnect).toHaveBeenCalled()
  })

  it('re-emits room:join for a persisted room on connect (resync after reload)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      serializeMockState({
        ...createInitialState(),
        player: { nickname: 'Ash', playerId: 'p1', sessionToken: 'token-1' },
        room: {
          code: 'AB12',
          maxPlayers: 2,
          status: 'waiting',
          players: [{ playerId: 'p1', nickname: 'Ash', ready: false, connected: true }],
        },
      }),
    )

    renderProvider()

    expect(io).toHaveBeenCalledTimes(1)
    expect(fakeSocket.emit).toHaveBeenCalledWith('room:join', {
      code: 'AB12',
      nickname: 'Ash',
    })
  })

  it('clears the persisted room when the server rejects the rejoin (room:join_rejected)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      serializeMockState({
        ...createInitialState(),
        player: { nickname: 'Ash', playerId: 'p1', sessionToken: 'token-1' },
        room: {
          code: 'AB12',
          maxPlayers: 2,
          status: 'waiting',
          players: [{ playerId: 'p1', nickname: 'Ash', ready: false, connected: true }],
        },
      }),
    )

    renderProvider()
    expect(screen.getByTestId('roster').textContent).toBe('Ash')

    act(() => {
      fakeSocket._fire('room:join_rejected')
    })

    expect(screen.getByTestId('roster').textContent).toBe('no-room')
  })
})
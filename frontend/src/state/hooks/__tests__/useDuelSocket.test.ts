// @vitest-environment jsdom
// RED/GREEN tests for useDuelSocket: the hook owns the socket lifecycle that
// used to live in MockStateProvider — connect once keyed on the session token,
// exactly one `socket.on` per WS event, one `socket.off` per event on unmount,
// plus the pendingJoin flush and persisted-room rejoin emits.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { createInitialState } from '../../store'
import type { MockState } from '../../schema'
import { setCachedCatalog } from '../../../lib/catalog'
import type { Pokemon } from '../../../lib/catalog'
import { useDuelSocket } from '../useDuelSocket'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { disconnectSocket } from '../../../lib/socket'

const SOCKET_EVENTS = [
  'connect',
  'room:state',
  'duel:start',
  'duel:state',
  'duel:turn_resolved',
  'duel:finished',
  'duel:action_rejected',
  'duel:switch_rejected',
  'duel:opponent_disconnected',
  'tournament:bracket',
  'room:final_ranking',
  'room:aborted',
  'room:join_rejected',
] as const

const wsCatalog: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'front-pikachu', back_sprite_url: 'back-pikachu', is_starter: true },
  { id: 5, name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'front-snorlax', back_sprite_url: 'back-snorlax', is_starter: false },
]

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

function baseState(overrides?: Partial<MockState>): MockState {
  return { ...createInitialState(), ...overrides }
}

function mount(token: string | null, opts?: { state?: MockState; pendingJoin?: string | null }) {
  const dispatch = vi.fn()
  const stateRef = { current: opts?.state ?? baseState() }
  const pendingJoinRef = { current: opts?.pendingJoin ?? null }
  const rendered = renderHook(() =>
    useDuelSocket({
      sessionToken: token,
      dispatch,
      stateRef,
      pendingJoinRef,
    }),
  )
  return { dispatch, stateRef, pendingJoinRef, ...rendered }
}

beforeEach(() => {
  fakeSocket = makeFakeSocket()
  vi.mocked(io).mockReturnValue(fakeSocket as never)
  setCachedCatalog(wsCatalog)
})

afterEach(() => {
  vi.clearAllMocks()
  setCachedCatalog(null)
  disconnectSocket()
})

describe('useDuelSocket', () => {
  it('connects once with the session token when a token exists and not at all without one', () => {
    mount(null)
    expect(io).not.toHaveBeenCalled()

    mount('token-1')
    expect(io).toHaveBeenCalledTimes(1)
    const [, opts] = vi.mocked(io).mock.calls[0]
    expect((opts as { auth: { sessionToken: string } }).auth.sessionToken).toBe('token-1')
  })

  it('subscribes exactly once to each socket event (12 WS events + connect)', () => {
    mount('token-1')
    for (const event of SOCKET_EVENTS) {
      expect(fakeSocket.on).toHaveBeenCalledWith(event, expect.any(Function))
    }
    expect(fakeSocket.on).toHaveBeenCalledTimes(SOCKET_EVENTS.length)
  })

  it('dispatches duelStateReceived when the server fires duel:state', () => {
    const { dispatch } = mount('token-1')
    act(() => {
      fakeSocket._fire('duel:state', {
        duelId: 42,
        turnNumber: 1,
        winnerId: null,
        endReason: null,
        pokemonStates: [
          { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
        ],
      })
    })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'duelStateReceived' }),
    )
  })

  it('unsubscribes every event, disconnects and clears the refs on unmount', () => {
    const { unmount, pendingJoinRef } = mount('token-1', { pendingJoin: '7' })
    unmount()
    for (const event of SOCKET_EVENTS) {
      expect(fakeSocket.off).toHaveBeenCalledWith(event)
    }
    expect(fakeSocket.disconnect).toHaveBeenCalled()
    expect(pendingJoinRef.current).toBeNull()
  })

  it('flushes a queued duel:join once the socket connects', () => {
    const { pendingJoinRef } = mount('token-1', { pendingJoin: '7' })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:join', { duelId: 7 })
    expect(pendingJoinRef.current).toBeNull()
  })

  it('re-emits room:join for a persisted room on connect', () => {
    mount('token-1', {
      state: baseState({
        player: { nickname: 'Ash', playerId: 'p1', sessionToken: 'token-1' },
        room: {
          code: 'AB12',
          maxPlayers: 2,
          status: 'waiting',
          players: [{ playerId: 'p1', nickname: 'Ash', ready: false, connected: true }],
        },
      }),
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('room:join', {
      code: 'AB12',
      nickname: 'Ash',
    })
  })

  it('threads payload.turnEvents into the duelTurnResolved action as attackSequence (Fase 7, PR8)', () => {
    const { dispatch } = mount('token-1')
    const turnEvents = [
      { type: 'resolved', playerId: 11, moveIndex: 2, damage: 25, effectiveness: 1, fainted: false },
      { type: 'resolved', playerId: 10, moveIndex: 4, damage: 10, effectiveness: 1, fainted: true },
    ]
    act(() => {
      fakeSocket._fire('duel:turn_resolved', {
        duelId: 42,
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        pokemonStates: [
          { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 90, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
        ],
        turnEvents,
      })
    })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'duelTurnResolved', attackSequence: turnEvents }),
    )
  })

  it('carries attackSequence null when turnEvents is absent from the payload (Fase 7, PR8)', () => {
    const { dispatch } = mount('token-1')
    act(() => {
      fakeSocket._fire('duel:turn_resolved', {
        duelId: 42,
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        pokemonStates: [],
      })
    })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'duelTurnResolved', attackSequence: null }),
    )
  })
})
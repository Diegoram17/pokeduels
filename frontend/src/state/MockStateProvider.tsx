import { createContext, useEffect, useMemo, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Socket } from 'socket.io-client'
import {
  loadMockState,
  saveMockState,
  reduceMockState,
  type MockStateAction,
} from './store'
import type {
  MockState,
  RoomPlayer,
  RoomStatus,
  DuelSlot,
  TeamSelectionState,
} from './schema'
import { connectSocket, disconnectSocket } from '../lib/socket'
import type { MoveIndex } from '../engine/damage'

export interface MockStateActions {
  setNickname(nickname: string): void
  sessionEstablished(payload: { playerId: string; sessionToken: string; nickname: string }): void
  receiveRoomShell(payload: { code: string; maxPlayers: 2 | 4; status: RoomStatus }): void
  receiveRoomState(payload: { code: string; maxPlayers: 2 | 4; status: RoomStatus; players: RoomPlayer[] }): void
  joinRoomWs(code: string): void
  setReady(ready: boolean): void
  selectStarter(pokemonId: number): void
  selectRoster(pokemonIds: number[]): void
  leaveRoomWs(): void
  updateTeamSelection(selection: Partial<TeamSelectionState>): void
  enterDuel(slot: DuelSlot): void
  applyPlayerAttack(moveIndex: MoveIndex): void
  confirmSwap(pokemonId: string): void
  surrender(): void
  advanceTournament(): void
  resetSession(): void
}

export type MockStateContextValue = [MockState, MockStateActions]

export const MockStateContext = createContext<MockStateContextValue | null>(null)

function dispatchAndPersist(dispatch: (action: MockStateAction) => void) {
  return (action: MockStateAction) => {
    dispatch(action)
  }
}

export function MockStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduceMockState, undefined, loadMockState)
  const socketRef = useRef<Socket | null>(null)

  // Persist on every change so the mock state survives reloads.
  useEffect(() => {
    saveMockState(state)
  }, [state])

  // WS lifecycle: connect once a backend session token exists (post-login),
  // subscribe to room:state for the enriched live roster, and disconnect
  // when the session resets or the provider unmounts.
  useEffect(() => {
    const token = state.player.sessionToken
    if (!token) return

    const socket = connectSocket(token)
    socketRef.current = socket
    socket.on('room:state', (payload: unknown) => {
      const room = payload as {
        code: string
        status: RoomStatus
        maxPlayers: 2 | 4
        players: RoomPlayer[]
      }
      send({
        type: 'roomStateReceived',
        code: room.code,
        maxPlayers: room.maxPlayers,
        status: room.status,
        players: room.players,
      })
    })

    return () => {
      socket.off('room:state')
      disconnectSocket()
      socketRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.player.sessionToken])

  const send = dispatchAndPersist(dispatch)

  const actions = useMemo<MockStateActions>(() => {
    return {
      setNickname: (nickname) => send({ type: 'setNickname', nickname }),
      sessionEstablished: (payload) =>
        send({
          type: 'sessionEstablished',
          playerId: payload.playerId,
          sessionToken: payload.sessionToken,
          nickname: payload.nickname,
        }),
      receiveRoomShell: (payload) =>
        send({
          type: 'roomShellReceived',
          code: payload.code,
          maxPlayers: payload.maxPlayers,
          status: payload.status,
        }),
      receiveRoomState: (payload) =>
        send({
          type: 'roomStateReceived',
          code: payload.code,
          maxPlayers: payload.maxPlayers,
          status: payload.status,
          players: payload.players,
        }),
      joinRoomWs: (code) => {
        socketRef.current?.emit('room:join', { code })
      },
      setReady: (ready) => {
        socketRef.current?.emit('room:ready', { ready })
      },
      selectStarter: (pokemonId) => {
        socketRef.current?.emit('team:select_starter', { pokemonId })
      },
      selectRoster: (pokemonIds) => {
        socketRef.current?.emit('team:select_roster', { pokemonIds })
      },
      leaveRoomWs: () => {
        socketRef.current?.emit('room:leave')
      },
      updateTeamSelection: (selection) =>
        send({ type: 'updateTeamSelection', selection }),
      enterDuel: (slot) => send({ type: 'enterDuel', slot }),
      applyPlayerAttack: (moveIndex) => send({ type: 'applyPlayerAttack', moveIndex }),
      confirmSwap: (pokemonId) => send({ type: 'confirmSwap', pokemonId }),
      surrender: () => send({ type: 'surrender' }),
      advanceTournament: () => send({ type: 'advanceTournament' }),
      resetSession: () => {
        // "Play again" keeps the nickname/token but must drop the live WS
        // connection (design: disconnect on resetSession).
        disconnectSocket()
        socketRef.current = null
        send({ type: 'resetSession' })
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<MockStateContextValue>(
    () => [state, actions],
    [state, actions],
  )

  return (
    <MockStateContext.Provider value={value}>{children}</MockStateContext.Provider>
  )
}
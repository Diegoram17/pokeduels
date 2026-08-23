import { createContext, useEffect, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
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
import type { MoveIndex } from '../engine/damage'

export interface MockStateActions {
  setNickname(nickname: string): void
  sessionEstablished(payload: { playerId: string; sessionToken: string; nickname: string }): void
  receiveRoomShell(payload: { code: string; maxPlayers: 2 | 4; status: RoomStatus }): void
  receiveRoomState(payload: { code: string; maxPlayers: 2 | 4; status: RoomStatus; players: RoomPlayer[] }): void
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

  // Persist on every change so the mock state survives reloads.
  useEffect(() => {
    saveMockState(state)
  }, [state])

  const actions = useMemo<MockStateActions>(() => {
    const send = dispatchAndPersist(dispatch)
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
      updateTeamSelection: (selection) =>
        send({ type: 'updateTeamSelection', selection }),
      enterDuel: (slot) => send({ type: 'enterDuel', slot }),
      applyPlayerAttack: (moveIndex) => send({ type: 'applyPlayerAttack', moveIndex }),
      confirmSwap: (pokemonId) => send({ type: 'confirmSwap', pokemonId }),
      surrender: () => send({ type: 'surrender' }),
      advanceTournament: () => send({ type: 'advanceTournament' }),
      resetSession: () => send({ type: 'resetSession' }),
    }
  }, [])

  const value = useMemo<MockStateContextValue>(
    () => [state, actions],
    [state, actions],
  )

  return (
    <MockStateContext.Provider value={value}>{children}</MockStateContext.Provider>
  )
}
import { createContext, useEffect, useMemo, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import { loadMockState, reduceMockState } from './store'
import type { MockState, RoomPlayer, RoomStatus, TeamSelectionState } from './schema'
import { disconnectSocket } from '../lib/socket'
import { toWireMoveIndex } from '../lib/moveIndex'
import type { MoveIndex } from '../lib/moveIndex'
import { useMockPersistence } from './hooks/useMockPersistence'
import { useDuelSocket } from './hooks/useDuelSocket'

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
  /** Emits duel:select_lead and optimistically activates the picked lead. */
  selectLead(pokemonId: number): void
  /** Emits duel:select_action with the 1-based move index the backend expects. */
  submitAction(moveIndex: MoveIndex): void
  /** Emits duel:switch_decision. */
  submitSwitch(pokemonId: number): void
  /** Legacy alias of submitSwitch kept for the pre-#10 SwapScreen. */
  confirmSwap(pokemonId: number): void
  /** Emits duel:surrender. */
  surrenderDuel(): void
  /** Emits duel:join for a server-announced duel id. */
  joinDuel(duelId: string): void
  /** Clears the room:aborted recovery banner (the player clicked "back to lobby"). */
  acknowledgeRoomAborted(): void
  /** Drops a finished duel from state so a rematch starts clean (no stale finish modal). */
  clearDuel(): void
  resetSession(): void
}

export type MockStateContextValue = [MockState, MockStateActions]

export const MockStateContext = createContext<MockStateContextValue | null>(null)

export function MockStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduceMockState, undefined, loadMockState)

  // Always-current state for socket listeners and emitting actions (the
  // connect effect and the actions memo capture the first render otherwise).
  const stateRef = useRef(state)
  // A duel:join queued while the socket was not yet connected (child mount
  // effects run BEFORE the provider's connect effect, so a screen mounting
  // with an in-progress duel — e.g. a refresh mid-duel — must not lose its
  // resync emit; it is flushed as soon as the socket exists).
  const pendingJoinRef = useRef<string | null>(null)

  useEffect(() => {
    stateRef.current = state
  })

  // Persist on every change so the mock state survives reloads.
  useMockPersistence(state)

  // WS lifecycle: connect once a backend session token exists (post-login),
  // subscribe to every room/duel/tournament event, and disconnect when the
  // session resets or the provider unmounts.
  const socketRef = useDuelSocket({
    sessionToken: state.player.sessionToken,
    dispatch,
    stateRef,
    pendingJoinRef,
  })

  const actions = useMemo<MockStateActions>(() => {
    return {
      setNickname: (nickname) => dispatch({ type: 'setNickname', nickname }),
      sessionEstablished: (payload) =>
        dispatch({
          type: 'sessionEstablished',
          // POST /api/session returns the player id as a Postgres integer; the
          // schema (PlayerState.playerId) is string, and strict === lookups
          // (isReady, BracketMini.nameOf) depend on the string form.
          playerId: String(payload.playerId),
          sessionToken: payload.sessionToken,
          nickname: payload.nickname,
        }),
      receiveRoomShell: (payload) =>
        dispatch({
          type: 'roomShellReceived',
          code: payload.code,
          maxPlayers: payload.maxPlayers,
          status: payload.status,
        }),
      receiveRoomState: (payload) =>
        dispatch({
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
        dispatch({ type: 'updateTeamSelection', selection }),
      selectLead: (pokemonId) => {
        const duelId = stateRef.current.duel?.duelId
        if (duelId == null) return
        socketRef.current?.emit('duel:select_lead', { duelId: Number(duelId), pokemonId })
        dispatch({
          type: 'duelLeadSelection',
          ownerId: Number(stateRef.current.player.playerId),
          pokemonId,
        })
      },
      submitAction: (moveIndex) => {
        const duelId = stateRef.current.duel?.duelId
        if (duelId == null) return
        socketRef.current?.emit('duel:select_action', {
          duelId: Number(duelId),
          moveIndex: toWireMoveIndex(moveIndex),
        })
      },
      submitSwitch: (pokemonId) => {
        const duelId = stateRef.current.duel?.duelId
        if (duelId == null) return
        socketRef.current?.emit('duel:switch_decision', {
          duelId: Number(duelId),
          switchTo: pokemonId,
        })
      },
      confirmSwap: (pokemonId) => {
        const duelId = stateRef.current.duel?.duelId
        if (duelId == null) return
        socketRef.current?.emit('duel:switch_decision', {
          duelId: Number(duelId),
          switchTo: pokemonId,
        })
      },
      surrenderDuel: () => {
        const duelId = stateRef.current.duel?.duelId
        if (duelId == null) return
        socketRef.current?.emit('duel:surrender', { duelId: Number(duelId) })
      },
      joinDuel: (duelId) => {
        const socket = socketRef.current
        if (socket) {
          socket.emit('duel:join', { duelId: Number(duelId) })
        } else {
          // Socket not connected yet (the provider's connect effect runs after
          // child mount effects): queue the join and flush it on connect so a
          // mount-time resync emit is never lost.
          pendingJoinRef.current = String(duelId)
        }
      },
      acknowledgeRoomAborted: () => {
        dispatch({ type: 'roomAbortedAcknowledged' })
      },
      clearDuel: () => {
        dispatch({ type: 'duelCleared' })
      },
      resetSession: () => {
        // "Play again" keeps the nickname/token but must drop the live WS
        // connection (design: disconnect on resetSession).
        disconnectSocket()
        socketRef.current = null
        pendingJoinRef.current = null
        dispatch({ type: 'resetSession' })
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
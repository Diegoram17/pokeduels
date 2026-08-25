import { createContext, useEffect, useMemo, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Socket } from 'socket.io-client'
import {
  loadMockState,
  saveMockState,
  reduceMockState,
  duelFromSnapshot,
  type DuelSnapshot,
  type MockStateAction,
} from './store'
import type {
  BracketPairing,
  DuelState,
  MockState,
  RoomPlayer,
  RoomStatus,
  TeamSelectionState,
  TournamentSlot,
} from './schema'
import type { RankingEntry } from '../lib/ranking'
import { connectSocket, disconnectSocket } from '../lib/socket'
import { getCachedCatalog } from '../lib/catalog'
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
  // A duel:join queued while the socket was not yet connected (child mount
  // effects run BEFORE the provider's connect effect, so a screen mounting
  // with an in-progress duel — e.g. a refresh mid-duel — must not lose its
  // resync emit; it is flushed as soon as the socket exists).
  const pendingJoinRef = useRef<string | null>(null)
  // Always-current state for socket listeners and emitting actions (the
  // connect effect and the actions memo capture the first render otherwise).
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  })

  // Persist on every change so the mock state survives reloads.
  useEffect(() => {
    saveMockState(state)
  }, [state])

  // WS lifecycle: connect once a backend session token exists (post-login),
  // subscribe to room:state for the enriched live roster plus every duel and
  // tournament event (single mount/unmount-safe subscription boundary — the
  // duel screens remount often, so per-screen listeners would miss events),
  // and disconnect when the session resets or the provider unmounts.
  useEffect(() => {
    const token = state.player.sessionToken
    if (!token) return

    const socket = connectSocket(token)
    socketRef.current = socket

    // Flush a duel:join queued by a screen that mounted before this effect ran
    // (child effects run before parent effects on mount) — e.g. DuelBoardScreen
    // re-emitting duel:join to resync mid-duel state after a refresh.
    const pendingJoin = pendingJoinRef.current
    if (pendingJoin != null) {
      pendingJoinRef.current = null
      socket.emit('duel:join', { duelId: Number(pendingJoin) })
    }
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

    // duel:start — the server announced a duel the player can enter.
    socket.on('duel:start', (payload: unknown) => {
      const { duelId } = payload as { duelId: number }
      send({ type: 'pendingDuelSet', duelId: String(duelId) })
    })

    // duel:state / duel:turn_resolved — camelCase snapshots mapped into client
    // state (phase derived, names/sprites enriched from the catalog; the slot
    // is resolved by the reducer against the current bracket projection).
    socket.on('duel:state', (payload: unknown) => {
      const { duel, duelPokemonState } = duelFromSnapshot(
        payload as DuelSnapshot,
        getCachedCatalog() ?? [],
      )
      send({ type: 'duelStateReceived', duel, duelPokemonState })
    })

    socket.on('duel:turn_resolved', (payload: unknown) => {
      const { duel, duelPokemonState } = duelFromSnapshot(
        payload as DuelSnapshot,
        getCachedCatalog() ?? [],
      )
      send({ type: 'duelTurnResolved', duel, duelPokemonState })
    })

    // duel:finished — server-finalized outcome; the client only records it.
    socket.on('duel:finished', (payload: unknown) => {
      const { duelId, winnerId, endReason } = payload as {
        duelId: number
        winnerId: number | null
        endReason: string | null
      }
      send({
        type: 'duelFinished',
        duelId: String(duelId),
        winnerId: winnerId != null ? String(winnerId) : '',
        endReason: (endReason ?? null) as DuelState['endReason'],
      })
    })

    // duel:action_rejected — surface the rejection without touching the turn.
    socket.on('duel:action_rejected', (payload: unknown) => {
      const { moveIndex, reason } = payload as { moveIndex: number; reason: string }
      send({ type: 'duelActionRejected', moveIndex: moveIndex - 1, reason })
    })

    // duel:opponent_disconnected — non-blocking notice, cleared by the next
    // snapshot (duelTurnResolved / duelFinished carry fresh duel state).
    socket.on('duel:opponent_disconnected', () => {
      send({ type: 'duelOpponentDisconnected' })
    })

    // tournament:bracket — merge the broadcast's slots into the projection.
    socket.on('tournament:bracket', (payload: unknown) => {
      const { bracket } = payload as {
        bracket: Partial<
          Record<TournamentSlot, { duelId: number; playerA: number; playerB: number } | null>
        >
      }
      const mapped: Partial<Record<TournamentSlot, BracketPairing | null>> = {}
      for (const [slot, pairing] of Object.entries(bracket)) {
        mapped[slot as TournamentSlot] = pairing
          ? {
              duelId: String(pairing.duelId),
              playerA: String(pairing.playerA),
              playerB: String(pairing.playerB),
            }
          : null
      }
      send({ type: 'tournamentBracket', bracket: mapped })
    })

    // room:final_ranking — authoritative podium rows.
    socket.on('room:final_ranking', (payload: unknown) => {
      const { ranking } = payload as {
        ranking: { playerId: number; nickname: string | null; finalRank: number }[]
      }
      const rows: RankingEntry[] = ranking.map((r) => ({
        rank: r.finalRank,
        name: r.nickname ?? String(r.playerId),
        champion: r.finalRank === 1,
      }))
      send({ type: 'roomFinalRanking', ranking: rows })
    })

    return () => {
      socket.off('room:state')
      socket.off('duel:start')
      socket.off('duel:state')
      socket.off('duel:turn_resolved')
      socket.off('duel:finished')
      socket.off('duel:action_rejected')
      socket.off('duel:opponent_disconnected')
      socket.off('tournament:bracket')
      socket.off('room:final_ranking')
      disconnectSocket()
      socketRef.current = null
      pendingJoinRef.current = null
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
      selectLead: (pokemonId) => {
        const duelId = stateRef.current.duel?.duelId
        if (duelId == null) return
        socketRef.current?.emit('duel:select_lead', { duelId: Number(duelId), pokemonId })
        send({
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
          moveIndex: moveIndex + 1,
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
      resetSession: () => {
        // "Play again" keeps the nickname/token but must drop the live WS
        // connection (design: disconnect on resetSession).
        disconnectSocket()
        socketRef.current = null
        pendingJoinRef.current = null
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
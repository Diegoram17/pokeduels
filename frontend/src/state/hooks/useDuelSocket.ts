import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { Socket } from 'socket.io-client'
import { duelFromSnapshot, type DuelSnapshot, type MockStateAction } from '../store'
import type {
  AttackEvent,
  BracketPairing,
  DuelState,
  MockState,
  RoomPlayer,
  RoomStatus,
  TournamentSlot,
} from '../schema'
import type { RankingEntry } from '../../lib/ranking'
import { connectSocket, disconnectSocket } from '../../lib/socket'
import { setSessionToken } from '../../lib/api'
import { getCachedCatalog } from '../../lib/catalog'
import { fromWireMoveIndex } from '../../lib/moveIndex'

export interface UseDuelSocketParams {
  /** Backend session token; the effect connects while it is non-null. */
  sessionToken: string | null
  /** Reducer dispatch — every WS event is mapped to an action and dispatched. */
  dispatch: (action: MockStateAction) => void
  /** Always-current state for listeners and the persisted-room rejoin. */
  stateRef: MutableRefObject<MockState>
  /** duel:join queued by a screen that mounted before the socket connected. */
  pendingJoinRef: MutableRefObject<string | null>
}

/**
 * Owns the socket lifecycle previously inlined in MockStateProvider: connect
 * once a backend session token exists (post-login), subscribe to room:state
 * for the enriched live roster plus every duel and tournament event (single
 * mount/unmount-safe subscription boundary — the duel screens remount often,
 * so per-screen listeners would miss events), and disconnect when the session
 * resets or the host unmounts. Returns the live socket ref for emitting
 * actions.
 */
export function useDuelSocket({
  sessionToken,
  dispatch,
  stateRef,
  pendingJoinRef,
}: UseDuelSocketParams): MutableRefObject<Socket | null> {
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const token = sessionToken
    if (!token) return

    // Keep the REST client's Authorization header in sync with the WS token
    // so POST /api/rooms and other authenticated endpoints work after a
    // page reload (the token is restored from localStorage by loadMockState).
    setSessionToken(token)

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

    // Re-sync a persisted room membership on every (re)connect — mirrors the
    // pendingJoinRef pattern above, but for rooms: loadMockState() can restore
    // a room from a previous session, and without this the client never tells
    // the server it's back, so it never receives a fresh room:state and every
    // room:ready/leave silently no-ops (socket.data.roomId stays undefined).
    const persistedRoomCode = stateRef.current.room?.code
    if (persistedRoomCode) {
      socket.emit('room:join', {
        code: persistedRoomCode,
        nickname: stateRef.current.player.nickname,
      })
    }

    socket.on('room:state', (payload: unknown) => {
      const room = payload as {
        code: string
        status: RoomStatus
        maxPlayers: 2 | 4
        players: RoomPlayer[]
      }
      dispatch({
        type: 'roomStateReceived',
        code: room.code,
        maxPlayers: room.maxPlayers,
        status: room.status,
        // The backend serializes Postgres integer ids as numbers, but the
        // schema (RoomPlayer.playerId) is string. Normalize here so the roster
        // matches state.player.playerId and the stringified bracket pairings
        // under strict === lookups (BracketMini.nameOf, isReady).
        players: room.players.map((p) => ({ ...p, playerId: String(p.playerId) })),
      })
    })

    // duel:start — the server announced a duel the player can enter.
    socket.on('duel:start', (payload: unknown) => {
      const { duelId } = payload as { duelId: number }
      dispatch({ type: 'pendingDuelSet', duelId: String(duelId) })
    })

    // duel:state / duel:turn_resolved — camelCase snapshots mapped into client
    // state (phase derived, names/sprites enriched from the catalog; the slot
    // is resolved by the reducer against the current bracket projection).
    socket.on('duel:state', (payload: unknown) => {
      const { duel, duelPokemonState } = duelFromSnapshot(
        payload as DuelSnapshot,
        getCachedCatalog() ?? [],
      )
      dispatch({ type: 'duelStateReceived', duel, duelPokemonState })
    })

    socket.on('duel:turn_resolved', (payload: unknown) => {
      const { duel, duelPokemonState } = duelFromSnapshot(
        payload as DuelSnapshot,
        getCachedCatalog() ?? [],
      )
      // Fase 7 (PR8): the additive turnEvents field (server resolution order)
      // becomes the transient attackSequence; `null` when absent so a legacy
      // payload never triggers a replay.
      const { turnEvents } = payload as DuelSnapshot & { turnEvents?: AttackEvent[] }
      dispatch({
        type: 'duelTurnResolved',
        duel,
        duelPokemonState,
        attackSequence: turnEvents ?? null,
      })
    })

    // duel:finished — server-finalized outcome; the client only records it.
    socket.on('duel:finished', (payload: unknown) => {
      const { duelId, winnerId, endReason } = payload as {
        duelId: number
        winnerId: number | null
        endReason: string | null
      }
      dispatch({
        type: 'duelFinished',
        duelId: String(duelId),
        winnerId: winnerId != null ? String(winnerId) : '',
        endReason: (endReason ?? null) as DuelState['endReason'],
      })
    })

    // duel:action_rejected — surface the rejection without touching the turn.
    socket.on('duel:action_rejected', (payload: unknown) => {
      const { moveIndex, reason } = payload as { moveIndex: number; reason: string }
      dispatch({ type: 'duelActionRejected', moveIndex: fromWireMoveIndex(moveIndex), reason })
    })

    // duel:switch_rejected — surface the rejection so the swap screen stays put
    // and the player can retry (no auto-navigation happens on rejection).
    socket.on('duel:switch_rejected', (payload: unknown) => {
      const { switchTo, reason } = payload as { switchTo: number; reason: string }
      dispatch({ type: 'duelSwitchRejected', switchTo, reason })
    })

    // duel:opponent_disconnected — non-blocking notice, cleared by the next
    // snapshot (duelTurnResolved / duelFinished carry fresh duel state).
    socket.on('duel:opponent_disconnected', () => {
      dispatch({ type: 'duelOpponentDisconnected' })
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
      dispatch({ type: 'tournamentBracket', bracket: mapped })
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
      dispatch({ type: 'roomFinalRanking', ranking: rows })
    })

    // room:aborted — the backend tore the room down / restarted (ADR-0008).
    // Surface a top-level flag driving a global recovery banner; no silent
    // auto-redirect (product decision). Arrives while on any screen.
    socket.on('room:aborted', (payload: unknown) => {
      const { reason } = payload as { reason: string }
      dispatch({ type: 'roomAborted', reason })
    })

    // room:join_rejected — the persisted room no longer exists server-side
    // (finished/aborted/deleted). Drop it locally instead of leaving the user
    // stuck on a dead wait-room screen forever.
    socket.on('room:join_rejected', () => {
      dispatch({ type: 'roomJoinRejected' })
    })

    return () => {
      socket.off('room:state')
      socket.off('duel:start')
      socket.off('duel:state')
      socket.off('duel:turn_resolved')
      socket.off('duel:finished')
      socket.off('duel:action_rejected')
      socket.off('duel:switch_rejected')
      socket.off('duel:opponent_disconnected')
      socket.off('tournament:bracket')
      socket.off('room:final_ranking')
      socket.off('room:aborted')
      socket.off('room:join_rejected')
      disconnectSocket()
      setSessionToken(null)
      socketRef.current = null
      pendingJoinRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken])

  return socketRef
}
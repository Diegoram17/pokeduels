// Mock-state schema — mirrors ADR-0002 entity shapes for the client-local mock.
// #10 PR 1: reshaped for server-driven duel/tournament state — the bracket is a
// local projection merged from tournament:bracket broadcasts, and duel pokemon
// identity is numeric (server-issued ids).

import type { RankingEntry } from '../lib/ranking'

export type { RankingEntry }

export interface PlayerState {
  nickname: string
  playerId: string | null // backend player id (POST /api/session)
  sessionToken: string | null // bearer token used for REST + WS auth
}

export type RoomMode = '1v1' | 'tournament'
export type RoomStatus = 'waiting' | 'in_progress' | 'finished' | 'aborted'

/** A seated player in the enriched room roster (WS room:state payload). */
export interface RoomPlayer {
  playerId: string
  nickname: string
  ready: boolean
  connected: boolean
}

export interface RoomState {
  code: string
  maxPlayers: 2 | 4
  status: RoomStatus
  players: RoomPlayer[]
}

export interface TeamSelectionState {
  starterId: number | null // numeric backend pokemon id (canonical identity)
  rosterIds: number[] // exactly 5 when complete
}

export type TournamentSlot = 'semiA' | 'semiB' | 'thirdPlace' | 'final'

export interface BracketPairing {
  duelId: string // the duel created for this slot (stringified server id)
  playerA: string
  playerB: string
}

/**
 * Local UI projection of the room's bracket, merged incrementally from each
 * `tournament:bracket` broadcast (semis arrive first, then final + third place
 * with non-overlapping slot keys). The mock-engine FIFO (queue/activeSlot/
 * results) is gone — "which slot is live" is answered by matching
 * `state.duel.duelId` against `bracket.<slot>.duelId`.
 */
export interface TournamentState {
  bracket: Partial<Record<TournamentSlot, BracketPairing | null>>
}

export interface DuelPokemonState {
  duelId: string
  ownerId: number // server-issued numeric player id
  pokemonId: number // server-issued numeric pokemon id
  name: string
  type: string
  spriteUrl: string
  backSpriteUrl: string
  currentHp: number
  ppMove1: number
  ppMove2: number
  ppMove3: number
  isActive: boolean
  fainted: boolean
}

export type DuelPhase = 'lead_selection' | 'awaiting_actions' | 'awaiting_switch' | 'finished'
export type DuelSlot = TournamentSlot | '1v1'

export interface DuelState {
  duelId: string
  slot: DuelSlot
  phase: DuelPhase
  turnNumber: number
  winnerId: string | null
  endReason: 'ko' | 'surrender' | 'disconnect' | 'walkover' | null
  /** True from `duel:opponent_disconnected` until the next snapshot arrives. */
  opponentDisconnected: boolean
  /** Last `duel:action_rejected` / `duel:switch_rejected` payload (insufficient_pp etc.); cleared on the next snapshot. */
  lastRejection: { moveIndex: number | null; reason: string } | null
}

export interface MockState {
  player: PlayerState
  room: RoomState | null
  teamSelection: TeamSelectionState
  tournament: TournamentState | null // null for 1v1 / before the first bracket broadcast
  duelPokemonState: DuelPokemonState[]
  duel: DuelState | null
  /** duelId of a server-announced duel the player can enter (duel:start); cleared once duel:state resolves. */
  pendingDuelId: string | null
  /** Authoritative podium, set only by room:final_ranking. */
  finalRanking: RankingEntry[] | null
  /** Set by room:aborted (backend restart / room torn down) to drive the global recovery banner; cleared by acknowledgeRoomAborted. */
  roomAborted: { reason: string } | null
}
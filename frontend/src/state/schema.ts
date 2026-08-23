// Mock-state schema — mirrors ADR-0002 entity shapes for the client-local mock.

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
  playerA: string
  playerB: string
}

export interface TournamentState {
  bracket: Partial<Record<TournamentSlot, BracketPairing | null>>
  // FIFO; seeded ["semiA","semiB"], appends ["thirdPlace","final"] once both semis resolve
  queue: TournamentSlot[]
  activeSlot: TournamentSlot
  results: Partial<Record<TournamentSlot, { winner: string; loser: string }>>
}

export interface DuelPokemonState {
  duelId: string
  ownerId: string
  pokemonId: string
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

export type DuelPhase = 'awaiting_actions' | 'awaiting_switch' | 'finished'
export type DuelSlot = TournamentSlot | '1v1'

export interface DuelState {
  duelId: string
  slot: DuelSlot
  phase: DuelPhase
  turnNumber: number
  winnerId: string | null
  endReason: 'ko' | 'surrender' | null
}

export interface MockState {
  player: PlayerState
  room: RoomState | null
  teamSelection: TeamSelectionState
  tournament: TournamentState | null // null for 1v1
  duelPokemonState: DuelPokemonState[]
  duel: DuelState | null
}
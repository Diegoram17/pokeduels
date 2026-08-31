import type {
  AttackEvent,
  BracketPairing,
  DuelPhase,
  DuelPokemonState,
  DuelSlot,
  DuelState,
  MockState,
  RoomPlayer,
  RoomState,
  RoomStatus,
  TeamSelectionState,
  TournamentSlot,
  TournamentState,
} from './schema'
import type { RankingEntry } from '../lib/ranking'
import { pokemonById, type Pokemon } from '../lib/catalog'

export const STORAGE_KEY = 'pokeduels:mockState'
export const SCHEMA_VERSION = 1

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface PersistedBlob {
  _v: number
  state: MockState
}

export function createInitialState(): MockState {
  return {
    player: { nickname: '', playerId: null, sessionToken: null },
    room: null,
    teamSelection: { starterId: null, rosterIds: [] },
    tournament: null,
    duelPokemonState: [],
    duel: null,
    pendingDuelId: null,
    finalRanking: null,
    roomAborted: null,
  }
}

function defaultStorage(): StorageLike | null {
  return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null
}

export function serializeMockState(state: MockState): string {
  const blob: PersistedBlob = { _v: SCHEMA_VERSION, state }
  return JSON.stringify(blob)
}

export function parseMockState(raw: string | null): MockState | null {
  if (!raw) return null
  try {
    const blob = JSON.parse(raw) as PersistedBlob
    if (blob._v !== SCHEMA_VERSION || !blob.state) return null
    return blob.state as MockState
  } catch {
    return null
  }
}

export function loadMockState(storage?: StorageLike): MockState {
  const store = storage ?? defaultStorage()
  if (!store) return createInitialState()
  const raw = store.getItem(STORAGE_KEY)
  const state = parseMockState(raw) ?? createInitialState()
  
  // Detect stale state: if there's a room but no playerId, or if the player
  // changed (different playerId) but room state persists, wipe everything
  // except the player identity to prevent cross-session contamination.
  if (state.room && (!state.player.playerId || !state.player.sessionToken)) {
    // Stale room state without valid session - clear it
    return {
      ...createInitialState(),
      player: state.player,
    }
  }
  
  return state
}

export function saveMockState(state: MockState, storage?: StorageLike): void {
  const store = storage ?? defaultStorage()
  if (!store) return
  store.setItem(STORAGE_KEY, serializeMockState(state))
}

// ---------------------------------------------------------------------------
// WS snapshot mapping (#10 PR 1) — pure functions translating the backend's
// camelCase duel snapshot (`mapDuelStateToCamelCase`) into client state. Kept
// in store.ts (not the provider) so they are unit-testable; the provider feeds
// them the live socket payloads.
// ---------------------------------------------------------------------------

/** One pokemon row of the backend's camelCase duel snapshot. */
export interface DuelSnapshotPokemon {
  duelId: number
  ownerId: number
  pokemonId: number
  type: string
  currentHp: number
  ppMove1: number
  ppMove2: number
  ppMove3: number
  isActive: boolean
  fainted: boolean
}

/** The camelCase duel snapshot pushed by `duel:state` / `duel:turn_resolved`. */
export interface DuelSnapshot {
  duelId: number
  turnNumber: number
  winnerId: number | null
  endReason: string | null
  pokemonStates: DuelSnapshotPokemon[]
}

/**
 * Maps one snapshot pokemon into client state, filling name/type/sprites from
 * the catalog (the backend snapshot intentionally omits them — see
 * mapDuelStateToCamelCase). Unknown ids keep a stub shape instead of crashing.
 */
export function toDuelPokemonState(raw: DuelSnapshotPokemon, catalog: Pokemon[]): DuelPokemonState {
  const seed = pokemonById(catalog, raw.pokemonId)
  return {
    duelId: String(raw.duelId),
    ownerId: raw.ownerId,
    pokemonId: raw.pokemonId,
    name: seed?.name ?? String(raw.pokemonId),
    type: seed?.type ?? raw.type,
    spriteUrl: seed?.sprite_url ?? '',
    backSpriteUrl: seed?.back_sprite_url ?? '',
    currentHp: raw.currentHp,
    ppMove1: raw.ppMove1,
    ppMove2: raw.ppMove2,
    ppMove3: raw.ppMove3,
    isActive: raw.isActive,
    fainted: raw.fainted,
  }
}

/**
 * Which tournament slot a duel belongs to, answered by matching the duel id
 * against the bracket projection (the mock-engine activeSlot pointer is gone).
 * Falls back to '1v1' outside a bracket (or for an unknown duel id).
 */
export function deriveDuelSlot(duelId: string, tournament: TournamentState | null): DuelSlot {
  if (!tournament) return '1v1'
  const slots = Object.keys(tournament.bracket) as TournamentSlot[]
  const slot = slots.find((s) => tournament.bracket[s]?.duelId === duelId)
  return slot ?? '1v1'
}

/**
 * Derives the client duel phase from a server snapshot. The backend does not
 * push a coarse phase; it is inferred from the winner and the active/fainted
 * flags (lead selection = no side fields a pokemon yet; awaiting_switch = one
 * side lost its active but keeps bench).
 */
export function deriveDuelPhase(winnerId: string | null, pokemonStates: DuelPokemonState[]): DuelPhase {
  if (winnerId != null) return 'finished'
  const byOwner = new Map<number, DuelPokemonState[]>()
  for (const p of pokemonStates) {
    const group = byOwner.get(p.ownerId) ?? []
    group.push(p)
    byOwner.set(p.ownerId, group)
  }
  const sides = [...byOwner.values()]
  if (sides.length < 2) return 'lead_selection'
  if (!sides.some((roster) => roster.some((p) => p.isActive))) return 'lead_selection'
  const needsSwitch = sides.some(
    (roster) => !roster.some((p) => p.isActive) && roster.some((p) => !p.fainted),
  )
  return needsSwitch ? 'awaiting_switch' : 'awaiting_actions'
}

/**
 * Full snapshot → client-state mapping: DuelState (phase derived, numeric ids
 * stringified at this boundary to match the client identity contract) plus the
 * enriched DuelPokemonState list. The slot starts as '1v1' and is corrected by
 * the reducer against the current tournament projection (the provider must not
 * read React state from socket listeners — the reducer owns fresh state).
 */
export function duelFromSnapshot(
  snapshot: DuelSnapshot,
  catalog: Pokemon[],
): { duel: DuelState; duelPokemonState: DuelPokemonState[] } {
  const duelPokemonState = snapshot.pokemonStates.map((p) => toDuelPokemonState(p, catalog))
  const duelId = String(snapshot.duelId)
  const winnerId = snapshot.winnerId != null ? String(snapshot.winnerId) : null
  return {
    duelPokemonState,
    duel: {
      duelId,
      slot: '1v1',
      phase: deriveDuelPhase(winnerId, duelPokemonState),
      turnNumber: snapshot.turnNumber,
      winnerId,
      endReason: (snapshot.endReason ?? null) as DuelState['endReason'],
      opponentDisconnected: false,
      lastRejection: null,
    },
  }
}

// ---------------------------------------------------------------------------
// Reducer — pure state transitions backing the MockStateActions exposed by the
// provider. Kept here (instead of in the component) so it is unit-testable.
// The local mock engine is gone: every duel/tournament transition originates
// from a server WS push (or an optimistic local echo of one).
// ---------------------------------------------------------------------------

export type MockStateAction =
  | { type: 'setNickname'; nickname: string }
  | { type: 'sessionEstablished'; playerId: string; sessionToken: string; nickname: string }
  | { type: 'roomShellReceived'; code: string; maxPlayers: 2 | 4; status: RoomStatus }
  | { type: 'roomStateReceived'; code: string; maxPlayers: 2 | 4; status: RoomStatus; players: RoomPlayer[] }
  | { type: 'updateTeamSelection'; selection: Partial<TeamSelectionState> }
  | { type: 'pendingDuelSet'; duelId: string }
  | { type: 'pendingDuelClear' }
  | { type: 'duelStateReceived'; duel: DuelState; duelPokemonState: DuelPokemonState[] }
  | { type: 'duelTurnResolved'; duel: DuelState; duelPokemonState: DuelPokemonState[]; attackSequence: AttackEvent[] | null }
  | { type: 'duelFinished'; duelId: string; winnerId: string; endReason: DuelState['endReason'] }
  | { type: 'duelLeadSelection'; ownerId: number; pokemonId: number }
  | { type: 'duelActionRejected'; moveIndex: number; reason: string }
  | { type: 'duelSwitchRejected'; switchTo: number; reason: string }
  | { type: 'duelOpponentDisconnected' }
  | { type: 'tournamentBracket'; bracket: Partial<Record<TournamentSlot, BracketPairing | null>> }
  | { type: 'roomFinalRanking'; ranking: RankingEntry[] }
  | { type: 'roomAborted'; reason: string }
  | { type: 'roomAbortedAcknowledged' }
  | { type: 'roomJoinRejected' }
  | { type: 'resetSession' }

export function reduceMockState(state: MockState, action: MockStateAction): MockState {
  switch (action.type) {
    case 'setNickname':
      return { ...state, player: { ...state.player, nickname: action.nickname } }

    case 'sessionEstablished':
      // New login session: wipe all room/game state to prevent cross-session
      // contamination (stale rooms, team selections, duels from previous user).
      // Only the player identity is carried over from the action.
      return {
        ...createInitialState(),
        player: {
          nickname: action.nickname,
          playerId: action.playerId,
          sessionToken: action.sessionToken,
        },
      }

    case 'roomShellReceived': {
      // REST create/join returns a room shell (code/maxPlayers/status) with an
      // empty roster — the live roster arrives later via WS room:state. The
      // shell opens a NEW room, so all room-scoped state (tournament, duel,
      // pending pointer, ranking) is reset; the bracket arrives from the
      // server via tournament:bracket when it bootstraps.
      const room: RoomState = {
        code: action.code,
        maxPlayers: action.maxPlayers,
        status: action.status,
        players: [],
      }
      return {
        ...state,
        room,
        tournament: null,
        duel: null,
        duelPokemonState: [],
        pendingDuelId: null,
        finalRanking: null,
      }
    }

    case 'roomStateReceived': {
      const room: RoomState = {
        code: action.code,
        maxPlayers: action.maxPlayers,
        status: action.status,
        players: action.players,
      }
      return { ...state, room }
    }

    case 'updateTeamSelection':
      return {
        ...state,
        teamSelection: { ...state.teamSelection, ...action.selection },
      }

    // duel:start { duelId } — the server announced a duel the player can join.
    // The pointer is cleared once duel:state resolves into state.duel.
    case 'pendingDuelSet':
      return { ...state, pendingDuelId: action.duelId }

    case 'pendingDuelClear':
      return { ...state, pendingDuelId: null }

    // duel:state — full snapshot after duel:join (incl. mid-duel resync). A
    // resync never replays: the attackSequence is transient and cleared here.
    case 'duelStateReceived':
      return {
        ...state,
        duel: {
          ...action.duel,
          slot: deriveDuelSlot(action.duel.duelId, state.tournament),
          attackSequence: null,
        },
        duelPokemonState: action.duelPokemonState,
        pendingDuelId: null,
      }

    // duel:turn_resolved — server-authoritative round outcome. A fresh
    // snapshot also clears the opponent-disconnect banner and the last
    // rejection (the opponent is back and the round moved on). The transient
    // attackSequence (Fase 7, PR8) drives the attack-replay animation.
    case 'duelTurnResolved':
      return {
        ...state,
        duel: {
          ...action.duel,
          slot: deriveDuelSlot(action.duel.duelId, state.tournament),
          attackSequence: action.attackSequence,
        },
        duelPokemonState: action.duelPokemonState,
      }

    // duel:finished { duelId, winnerId, endReason } — the server finalizes the
    // duel; the client only marks the outcome (no local winner computation).
    case 'duelFinished': {
      const duel = state.duel
      if (!duel || duel.duelId !== action.duelId) return state
      return {
        ...state,
        duel: {
          ...duel,
          phase: 'finished',
          winnerId: action.winnerId,
          endReason: action.endReason,
          opponentDisconnected: false,
          lastRejection: null,
          attackSequence: null,
        },
      }
    }

    // Optimistic echo of the player's own duel:select_lead emit: activate the
    // picked lead locally so the picker UI reflects it immediately. Phase stays
    // 'lead_selection' — only the server's duel:state broadcast (once BOTH
    // leads are ready) advances the phase, via deriveDuelPhase on the real snapshot.
    case 'duelLeadSelection': {
      const { duel, duelPokemonState } = state
      if (!duel || duel.phase !== 'lead_selection') return state
      const updated = duelPokemonState.map((p) =>
        p.ownerId === action.ownerId && p.pokemonId === action.pokemonId
          ? { ...p, isActive: true }
          : p,
      )
      return {
        ...state,
        duelPokemonState: updated,
      }
    }

    // duel:action_rejected — surface the rejection WITHOUT advancing the turn
    // or resetting the timer (insufficient_pp must not consume the round).
    case 'duelActionRejected': {
      const duel = state.duel
      if (!duel) return state
      return {
        ...state,
        duel: { ...duel, lastRejection: { moveIndex: action.moveIndex, reason: action.reason } },
      }
    }

    // duel:switch_rejected — surface the rejection so the swap screen can stay
    // put and let the player retry; the phase/turn are untouched.
    case 'duelSwitchRejected': {
      const duel = state.duel
      if (!duel) return state
      return {
        ...state,
        duel: { ...duel, lastRejection: { moveIndex: null, reason: action.reason } },
      }
    }

    // duel:opponent_disconnected — non-blocking notice; cleared by the next
    // snapshot (duelTurnResolved / duelFinished carry fresh duel state).
    case 'duelOpponentDisconnected': {
      const duel = state.duel
      if (!duel) return state
      return { ...state, duel: { ...duel, opponentDisconnected: true } }
    }

    // tournament:bracket — merge the broadcast's slots into the local bracket
    // projection (semis arrive first, then final + third place).
    case 'tournamentBracket': {
      const current = state.tournament?.bracket ?? {}
      return {
        ...state,
        tournament: { bracket: { ...current, ...action.bracket } },
      }
    }

    // room:final_ranking — the authoritative podium; replaces any provisional
    // ranking the client may have shown.
    case 'roomFinalRanking':
      return { ...state, finalRanking: action.ranking }

    // room:aborted — the backend restarted / tore the room down (ADR-0008).
    // The player may be on any screen, so we surface a top-level flag that a
    // global banner reads; no silent auto-redirect (product decision).
    case 'roomAborted':
      return { ...state, roomAborted: { reason: action.reason } }

    // The player clicked "back to lobby" on the recovery banner.
    case 'roomAbortedAcknowledged':
      return { ...state, roomAborted: null }

    // room:join_rejected — the persisted room no longer exists server-side
    // (finished/aborted/deleted). Reset the room-scoped slice so WaitRoomScreen
    // (which redirects to /lobby when !room) bounces the user instead of
    // leaving them stuck on a dead wait-room screen.
    case 'roomJoinRejected':
      return {
        ...state,
        room: null,
        tournament: null,
        duel: null,
        pendingDuelId: null,
      }

    // "Play again": wipe the whole session (room, team, tournament, duel,
    // pending duel, ranking) but keep the player's nickname (design:
    // PlayAgainButton on the ranking screen).
    case 'resetSession':
      return { ...createInitialState(), player: state.player }

    default:
      return state
  }
}
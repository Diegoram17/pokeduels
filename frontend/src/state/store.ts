import type {
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
import { resolveTurn, type TurnResult } from '../engine/turnResolution'
import { advanceQueue } from '../engine/tournamentQueue'
import { slotLoserId } from '../lib/duelFlow'
import { pokemonById, getCachedCatalog } from '../lib/catalog'
import type { Pokemon } from '../lib/catalog'
import type { MoveIndex } from '../engine/damage'

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
  return parseMockState(raw) ?? createInitialState()
}

export function saveMockState(state: MockState, storage?: StorageLike): void {
  const store = storage ?? defaultStorage()
  if (!store) return
  store.setItem(STORAGE_KEY, serializeMockState(state))
}

// ---------------------------------------------------------------------------
// Reducer — pure state transitions backing the MockStateActions exposed by the
// provider. Kept here (instead of in the component) so it is unit-testable.
// ---------------------------------------------------------------------------

export type MockStateAction =
  | { type: 'setNickname'; nickname: string }
  | { type: 'sessionEstablished'; playerId: string; sessionToken: string; nickname: string }
  | { type: 'roomShellReceived'; code: string; maxPlayers: 2 | 4; status: RoomStatus }
  | { type: 'roomStateReceived'; code: string; maxPlayers: 2 | 4; status: RoomStatus; players: RoomPlayer[] }
  | { type: 'updateTeamSelection'; selection: Partial<TeamSelectionState> }
  | { type: 'enterDuel'; slot: DuelSlot }
  | { type: 'applyPlayerAttack'; moveIndex: MoveIndex }
  | { type: 'confirmSwap'; pokemonId: string }
  | { type: 'surrender' }
  | { type: 'advanceTournament' }
  | { type: 'resetSession' }

const MOVE_PP = [4, 4, 4] as const

function makeDuelPokemon(
  duelId: string,
  ownerId: string,
  pokemonId: string,
  seed: Pokemon | null,
  isActive: boolean,
  hp = 100,
): DuelPokemonState {
  return {
    duelId,
    ownerId,
    pokemonId,
    name: seed?.name ?? pokemonId,
    type: seed?.type ?? 'normal',
    spriteUrl: seed?.sprite_url ?? '',
    backSpriteUrl: seed?.back_sprite_url ?? '',
    currentHp: hp,
    ppMove1: MOVE_PP[0],
    ppMove2: MOVE_PP[1],
    ppMove3: MOVE_PP[2],
    isActive,
    fainted: false,
  }
}

// The rival's fixed team, keyed by the catalog's numeric backend ids (sourced
// from a real GET /api/pokemons response during implementation — see
// apply-decisions for the id→name mapping). Kept to catalog entries so the
// duel resolves real sprites for both sides.
const BOT_ROSTER = [6, 23, 14, 17, 33, 15]

function makeDuel(duelId: string, slot: DuelSlot): DuelState {
  return {
    duelId,
    slot,
    phase: 'awaiting_actions',
    turnNumber: 1,
    winnerId: null,
    endReason: null,
  }
}

function makeTournament(): TournamentState {
  return {
    bracket: {},
    queue: ['semiA', 'semiB'],
    activeSlot: 'semiA',
    results: {},
  }
}

function enterDuel(state: MockState, slot: DuelSlot): MockState {
  const { teamSelection, player } = state
  const roster = teamSelection.starterId && teamSelection.rosterIds.length === 5
  if (!roster || !state.room) return state

  const duelId = `${slot}-${Date.now()}`
  const humanIds = [teamSelection.starterId!, ...teamSelection.rosterIds]
  const catalog = getCachedCatalog()
  // Duel-level identity stays a string (DuelPokemonState.pokemonId: string is
  // #10's contract) — numeric ids are stringified at this boundary.
  const toDuelPokemon = (id: number, ownerId: string, isActive: boolean) =>
    makeDuelPokemon(duelId, ownerId, String(id), pokemonById(catalog, id) ?? null, isActive)

  const duelPokemonState: DuelPokemonState[] = [
    ...humanIds.map((id, i) => toDuelPokemon(id, player.nickname, i === 0)),
    ...BOT_ROSTER.map((id, i) => toDuelPokemon(id, 'bot', i === 0)),
  ]

  return {
    ...state,
    duelPokemonState,
    duel: makeDuel(duelId, slot),
  }
}

function mergeTurnResult(state: MockState, result: TurnResult): MockState {
  return { ...state, duelPokemonState: result.duelPokemonState, duel: result.duel }
}

function recordResultAndAdvance(state: MockState): MockState {
  const { tournament, duel } = state
  if (!tournament || !duel || duel.phase !== 'finished' || !duel.winnerId) {
    return state
  }
  const slot = duel.slot as TournamentSlot
  const loser = slotLoserId(state)
  if (!loser) return state

  const results = { ...tournament.results, [slot]: { winner: duel.winnerId, loser } }
  const next = advanceQueue({ ...tournament, results })
  return { ...state, tournament: next }
}

export function reduceMockState(state: MockState, action: MockStateAction): MockState {
  switch (action.type) {
    case 'setNickname':
      return { ...state, player: { ...state.player, nickname: action.nickname } }

    case 'sessionEstablished':
      return {
        ...state,
        player: {
          nickname: action.nickname,
          playerId: action.playerId,
          sessionToken: action.sessionToken,
        },
      }

    case 'roomShellReceived': {
      // REST create/join returns a room shell (code/maxPlayers/status) with an
      // empty roster — the live roster arrives later via WS room:state. A
      // 4-player shell seeds the tournament queue so the existing wait-room /
      // duel/tournament mock flow keeps working (reducer surface untouched).
      const room: RoomState = {
        code: action.code,
        maxPlayers: action.maxPlayers,
        status: action.status,
        players: [],
      }
      return {
        ...state,
        room,
        tournament: action.maxPlayers === 4 ? makeTournament() : null,
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

    case 'enterDuel':
      return enterDuel(state, action.slot)

    case 'applyPlayerAttack': {
      const duel = state.duel
      if (!duel || duel.phase !== 'awaiting_actions') return state
      return mergeTurnResult(state, resolveTurn(action.moveIndex, state))
    }

    case 'confirmSwap': {
      const { duel, duelPokemonState, player } = state
      // Allowed from awaiting_actions (voluntary swap) and awaiting_switch
      // (forced swap after KO); blocked once the duel is finished.
      if (!duel || duel.phase === 'finished') return state
      const target = duelPokemonState.find(
        (p) => p.ownerId === player.nickname && p.pokemonId === action.pokemonId,
      )
      if (!target) return state
      const updated = duelPokemonState.map((p) => {
        if (p.ownerId !== player.nickname) return p
        const isTarget = p.pokemonId === action.pokemonId
        return { ...p, isActive: isTarget, fainted: isTarget ? false : p.fainted }
      })
      return {
        ...state,
        duelPokemonState: updated,
        duel: { ...duel, phase: 'awaiting_actions' },
      }
    }

    case 'surrender': {
      const { duel, duelPokemonState, player } = state
      if (!duel || duel.phase === 'finished') return state
      const opponent = duelPokemonState.find((p) => p.ownerId !== player.nickname)
      return {
        ...state,
        duel: {
          ...duel,
          phase: 'finished',
          winnerId: opponent?.ownerId ?? 'bot',
          endReason: 'surrender',
        },
      }
    }

    case 'advanceTournament':
      return recordResultAndAdvance(state)

    // "Play again": wipe the whole session (room, team, tournament, duel) but
    // keep the player's nickname (design: PlayAgainButton on the ranking screen).
    case 'resetSession':
      return { ...createInitialState(), player: state.player }

    default:
      return state
  }
}
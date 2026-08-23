import type { RoomMode, RoomState, RoomStatus } from '../state/schema'

// Room helpers for the lobby screen: code normalization/matching, derived
// mode and status labels (RF-1.2 join-by-code, room list).

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase()
}

export function matchesRoomCode(code: string, room: RoomState | null): boolean {
  if (!room) return false
  return normalizeRoomCode(code) === room.code
}

/**
 * Derives the room mode from max_players at render/use time (decision #2,
 * obs #188): 2 → 1v1, 4 → tournament. No `mode` field is persisted.
 */
export function roomMode(maxPlayers: 2 | 4): RoomMode {
  if (maxPlayers === 4) return 'tournament'
  return '1v1'
}

export function roomModeLabel(mode: RoomMode): string {
  if (mode === '1v1') return 'DUELO 1V1'
  return 'TORNEO DE 4'
}

export function roomStatusLabel(status: RoomStatus): string {
  switch (status) {
    case 'waiting':
      return 'ESPERANDO ENTRENADORES'
    case 'in_progress':
      return 'EN COMBATE'
    case 'finished':
      return 'FINALIZADA'
    case 'aborted':
      return 'ABANDONADA'
  }
}
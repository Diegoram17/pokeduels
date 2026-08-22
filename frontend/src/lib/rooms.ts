import type { RoomMode, RoomState, RoomStatus } from '../state/schema'

// Room helpers for the lobby screen: code normalization/matching, mode and
// status labels (RF-1.2 join-by-code, room list).

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase()
}

export function matchesRoomCode(code: string, room: RoomState | null): boolean {
  if (!room) return false
  return normalizeRoomCode(code) === room.code
}

export function roomModeLabel(mode: RoomMode): string {
  return mode === '1v1' ? 'DUELO 1V1' : 'TORNEO DE 4'
}

export function roomStatusLabel(status: RoomStatus): string {
  switch (status) {
    case 'waiting':
      return 'ESPERANDO ENTRENADORES'
    case 'in_progress':
      return 'EN COMBATE'
    case 'finished':
      return 'FINALIZADA'
  }
}
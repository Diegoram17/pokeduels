import type { RoomState, TournamentSlot } from '../state/schema'

// Wait-room helpers: tournament slot labels, the player list,
// and the semifinal pairings for the mini bracket.

export const SLOT_LABELS: Record<TournamentSlot, string> = {
  semiA: 'SEMIFINAL A',
  semiB: 'SEMIFINAL B',
  thirdPlace: '3ER PUESTO',
  final: 'FINAL',
}

export interface PlayerEntry {
  name: string
  isBot: boolean
  ready: boolean
  playerId?: string
}

export function slotLabel(slot: TournamentSlot): string {
  return SLOT_LABELS[slot]
}

/**
 * Builds the player list from actual room players (humans + bots).
 * Bots are identified by the "🤖" prefix in their nickname (set by backend).
 */
export function buildPlayerList(room: RoomState): PlayerEntry[] {
  return room.players.map((player) => ({
    name: player.nickname,
    isBot: player.nickname.startsWith('🤖'),
    ready: player.ready,
    playerId: player.playerId,
  }))
}

export function semifinalPairings(players: string[]): [string, string][] {
  return [
    [players[0] ?? 'TBD', players[1] ?? 'TBD'],
    [players[2] ?? 'TBD', players[3] ?? 'TBD'],
  ]
}
import type { RoomState, TournamentSlot } from '../state/schema'

// Wait-room helpers: tournament slot labels, the player list with bot fillers,
// and the semifinal pairings for the mini bracket.

export const SLOT_LABELS: Record<TournamentSlot, string> = {
  semiA: 'SEMIFINAL A',
  semiB: 'SEMIFINAL B',
  thirdPlace: '3ER PUESTO',
  final: 'FINAL',
}

export const BOT_NAMES = ['VORTEX_99', 'STEALTH_OP', 'CYBER_RONIN']

export interface PlayerEntry {
  name: string
  isBot: boolean
}

export function slotLabel(slot: TournamentSlot): string {
  return SLOT_LABELS[slot]
}

export function buildPlayerList(room: RoomState): PlayerEntry[] {
  const humans = room.players.map((player) => ({ name: player.nickname, isBot: false }))
  const missing = Math.max(0, room.maxPlayers - room.players.length)
  const bots = BOT_NAMES.slice(0, missing).map((name) => ({ name, isBot: true }))
  return [...humans, ...bots]
}

export function semifinalPairings(players: string[]): [string, string][] {
  return [
    [players[0] ?? 'TBD', players[1] ?? 'TBD'],
    [players[2] ?? 'TBD', players[3] ?? 'TBD'],
  ]
}
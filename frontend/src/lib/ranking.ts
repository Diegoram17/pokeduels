import type { MockState } from '../state/schema'
import { roomMode } from './rooms'

// Ranking podium builder. Scoped to the current room/session only (ADR-0002:
// no persistent cross-session ranking) — the entries come straight from the
// finished duel (1v1) or the tournament results.

export interface RankingEntry {
  rank: number
  name: string
  champion: boolean
}

/**
 * Builds the podium rows from the current session state:
 * - 1v1: duel winner 1st, duel loser 2nd.
 * - Tournament: final winner 1st, final loser 2nd, 3rd-place winner 3rd,
 *   3rd-place loser 4th (only once both finishing duels have concluded).
 */
export function buildRanking(state: MockState): RankingEntry[] {
  const { room, duel, tournament, duelPokemonState } = state
  if (!room) return []

  if (roomMode(room.maxPlayers) !== 'tournament' || !tournament) {
    if (!duel || !duel.winnerId) return []
    const loser = duelPokemonState.find((p) => p.ownerId !== duel.winnerId)?.ownerId
    return [
      { rank: 1, name: duel.winnerId, champion: true },
      ...(loser ? [{ rank: 2, name: loser, champion: false }] : []),
    ]
  }

  const { final, thirdPlace } = tournament.results
  if (!final || !thirdPlace) return []
  return [
    { rank: 1, name: final.winner, champion: true },
    { rank: 2, name: final.loser, champion: false },
    { rank: 3, name: thirdPlace.winner, champion: false },
    { rank: 4, name: thirdPlace.loser, champion: false },
  ]
}
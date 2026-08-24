import type { MockState, TournamentSlot } from '../state/schema'

// Ranking podium builder (#10 PR 2). The podium is server-driven: the
// authoritative rows arrive via room:final_ranking and buildRanking returns
// them verbatim. While a 4-player bracket room has not closed, buildProvisional
// Ranking synthesizes a local fallback from the bracket projection + the
// player's own finished duel so "view now" can render something useful — the
// authoritative rows silently replace it when room:final_ranking lands.

export interface RankingEntry {
  rank: number
  name: string
  champion: boolean
}

/** Server-driven podium: the room:final_ranking rows, verbatim (empty until they arrive). */
export function buildRanking(state: MockState): RankingEntry[] {
  return state.finalRanking ?? []
}

const SLOT_ORDER: TournamentSlot[] = ['semiA', 'semiB', 'thirdPlace', 'final']

/**
 * Local provisional podium for the wait-vs-go-now path: the player's finished
 * duel gives the top two places (winner champion, loser second), then the
 * remaining bracket participants follow in slot order. Names come from the
 * room roster when available (the bracket carries numeric ids).
 */
export function buildProvisionalRanking(state: MockState): RankingEntry[] {
  const { tournament, duel, duelPokemonState, room } = state
  if (!tournament || !duel || duel.phase !== 'finished' || !duel.winnerId) return []

  const nameOf = (id: string): string =>
    room?.players.find((p) => p.playerId === id)?.nickname ?? id

  const winnerId = duel.winnerId
  const loserOwnerId = duelPokemonState.find((p) => String(p.ownerId) !== winnerId)?.ownerId
  if (loserOwnerId == null) return []
  const loserId = String(loserOwnerId)

  const seen = new Set<string>([winnerId, loserId])
  const rows: RankingEntry[] = [
    { rank: 1, name: nameOf(winnerId), champion: true },
    { rank: 2, name: nameOf(loserId), champion: false },
  ]

  for (const slot of SLOT_ORDER) {
    const pairing = tournament.bracket[slot]
    if (!pairing) continue
    for (const id of [pairing.playerA, pairing.playerB]) {
      if (seen.has(id)) continue
      seen.add(id)
      rows.push({ rank: rows.length + 1, name: nameOf(id), champion: false })
    }
  }

  return rows
}
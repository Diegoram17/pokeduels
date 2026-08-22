// Team selection rules (RF-3.1 + roster requirement): exactly 1 exclusive
// starter (deselect-first) and exactly 5 roster picks.

export const ROSTER_SIZE = 5

export function toggleStarter(current: string | null, clicked: string): string | null {
  // Exclusive: picking a new starter requires deselecting the current one, so
  // only the selected starter can be toggled off; a different pick is ignored.
  if (current === null) return clicked
  return current === clicked ? null : current
}

export function toggleRoster(roster: string[], id: string, max = ROSTER_SIZE): string[] {
  if (roster.includes(id)) {
    return roster.filter((entry) => entry !== id)
  }
  if (roster.length >= max) return roster
  return [...roster, id]
}

export function isTeamComplete(starterId: string | null, rosterIds: string[]): boolean {
  return starterId !== null && rosterIds.length === ROSTER_SIZE
}
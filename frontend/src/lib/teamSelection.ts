// Team selection rules (RF-3.1 + roster requirement): exactly 1 exclusive
// starter (deselect-first) and exactly 5 roster picks. Pokemon identity is
// the numeric backend id (decision #1, obs #188).

export const ROSTER_SIZE = 5

export function toggleStarter(current: number | null, clicked: number): number | null {
  // Exclusive: picking a new starter requires deselecting the current one, so
  // only the selected starter can be toggled off; a different pick is ignored.
  if (current === null) return clicked
  return current === clicked ? null : current
}

export function toggleRoster(roster: number[], id: number, max = ROSTER_SIZE): number[] {
  if (roster.includes(id)) {
    return roster.filter((entry) => entry !== id)
  }
  if (roster.length >= max) return roster
  return [...roster, id]
}

export function isTeamComplete(starterId: number | null, rosterIds: number[]): boolean {
  return starterId !== null && rosterIds.length === ROSTER_SIZE
}
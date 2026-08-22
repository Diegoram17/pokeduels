// Fixed damage percentages per move slot, mirroring poke-duel-engine's MOVES
// values by shape only (no import). All matchups are neutral (×1 multiplier).

export type MoveIndex = 0 | 1 | 2 | 3

const MOVE_DAMAGE: Record<MoveIndex, number> = {
  0: 25,
  1: 20,
  2: 15,
  3: 10,
}

export function computeDamage(moveIndex: MoveIndex): number {
  return MOVE_DAMAGE[moveIndex]
}
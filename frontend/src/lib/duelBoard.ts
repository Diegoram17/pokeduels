import type { MoveIndex } from '../engine/damage'

// Duel-board presentation constants: the four fixed-damage move slots shown on
// the move grid, the per-turn countdown, and the basic attack used when the
// timer expires (RF-6.1: "sin tiempo, ataque básico").

export const MAX_HP = 100
export const TURN_TIMEOUT_SECONDS = 8
// Lead-selection countdown (spec: "The countdown shown MUST be cosmetic and
// MUST NOT auto-submit on expiry"). Unspecified duration — picked here; the
// server owns lead selection, so expiry only leaves the pick available.
export const LEAD_SELECTION_TIMEOUT_SECONDS = 30
export const BASIC_ATTACK_INDEX: MoveIndex = 3
export const TIMEOUT_NOTICE = 'SIN TIEMPO, ATAQUE BÁSICO'

export interface MoveSlot {
  name: string
  damage: number
}

// Index-aligned with engine/damage.ts: {0:25, 1:20, 2:15, 3:10}.
export const MOVE_SLOTS: MoveSlot[] = [
  { name: 'GOLPE FUERTE', damage: 25 },
  { name: 'ATAQUE VELOZ', damage: 20 },
  { name: 'GOLPE RÁPIDO', damage: 15 },
  { name: 'ATAQUE BÁSICO', damage: 10 },
]

export function moveDamageLabel(moveIndex: MoveIndex): string {
  return `${MOVE_SLOTS[moveIndex].damage}% DMG`
}

export function isBasicAttack(moveIndex: MoveIndex): boolean {
  return moveIndex === BASIC_ATTACK_INDEX
}
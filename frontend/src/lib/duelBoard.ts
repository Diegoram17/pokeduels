import type { MoveIndex } from './moveIndex'

// Duel-board presentation constants: the four fixed-damage move slots shown on
// the move grid, the per-turn countdown, and the basic attack used when the
// timer expires (RF-6.1: "sin tiempo, ataque básico").

export const MAX_HP = 100
// Per-turn countdown. MUST match the server auto-attack window
// (backend/ws/turnTimers.js DEFAULT_TURN_TIMEOUT_MS = 10_000; PRD RF-6.1) so
// the client countdown and the server timeout fire together.
export const TURN_TIMEOUT_SECONDS = 10
// Swap screen "EN PELIGRO" threshold: a live unit at or below 20% HP gets the
// danger flag (matches HpBar's low tier at pct <= 20).
export const LOW_HP_THRESHOLD = MAX_HP * 0.2
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

// Index-aligned move-damage values: {0:25, 1:20, 2:15, 3:10}.
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
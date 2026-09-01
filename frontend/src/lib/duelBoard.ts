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

// Display-only move names per Pokémon type (frontend constant, same pattern
// as TeamSelectScreen's TYPE_LABELS — no seed/DB/backend involved). Damage
// per slot and move resolution stay exactly MOVE_SLOTS/moveIndex; this only
// changes the label shown on the move grid.
export const MOVE_NAMES_BY_TYPE: Record<string, [string, string, string, string]> = {
  normal: ['PLACAJE FEROZ', 'GOLPE CUERPO', 'ATAQUE RÁPIDO', 'ATAQUE BÁSICO'],
  fire: ['LLAMARADA', 'LANZALLAMAS', 'ASCUAS', 'ATAQUE BÁSICO'],
  water: ['HIDROBOMBA', 'SURF', 'PISTOLA AGUA', 'ATAQUE BÁSICO'],
  electric: ['RAYO', 'CHISPAZO', 'IMPACTRUENO', 'ATAQUE BÁSICO'],
  grass: ['LÁTIGO CEPA', 'HOJA AFILADA', 'DRENADOSOL', 'ATAQUE BÁSICO'],
  ice: ['VENTISCA', 'RAYO HIELO', 'VIENTO HELADO', 'ATAQUE BÁSICO'],
  fighting: ['GOLPE KÁRATE', 'PATADA GIRO', 'COMBO DE PUÑOS', 'ATAQUE BÁSICO'],
  poison: ['BOMBA LODO', 'PÚAS VENENOSAS', 'GAS TÓXICO', 'ATAQUE BÁSICO'],
  ground: ['TERREMOTO', 'GOLPE CAVAR', 'LANZAROCAS', 'ATAQUE BÁSICO'],
  flying: ['ATAQUE AÉREO', 'TORNADO', 'RÁFAGA DE VIENTO', 'ATAQUE BÁSICO'],
  psychic: ['PSÍQUICO', 'CONFUSIÓN', 'PODER OCULTO', 'ATAQUE BÁSICO'],
  bug: ['ZUMBIDO', 'PICOTAZO VENENOSO', 'CORTE FURIA', 'ATAQUE BÁSICO'],
  rock: ['AVALANCHA', 'LANZARROCAS', 'PEDRADA', 'ATAQUE BÁSICO'],
  ghost: ['BOLA SOMBRA', 'MAL DE OJO', 'LAMENTO', 'ATAQUE BÁSICO'],
  dragon: ['ALIENTO DRAGÓN', 'GARRA DRAGÓN', 'PULSO DRAGÓN', 'ATAQUE BÁSICO'],
  dark: ['PULSO UMBRÍO', 'MORDISCO', 'GOLPE BAJO', 'ATAQUE BÁSICO'],
  steel: ['PUÑO BALA', 'GARRA METAL', 'CABEZAZO HIERRO', 'ATAQUE BÁSICO'],
  fairy: ['VIENTO HADA', 'BENGALA ÁUREA', 'BESO DRENADOR', 'ATAQUE BÁSICO'],
}

/** Resolves the themed move name for a type; falls back to the generic MOVE_SLOTS name for an unknown/missing type. */
export function moveNameForType(type: string | undefined, moveIndex: MoveIndex): string {
  return MOVE_NAMES_BY_TYPE[type ?? '']?.[moveIndex] ?? MOVE_SLOTS[moveIndex].name
}

export function moveDamageLabel(moveIndex: MoveIndex): string {
  return `${MOVE_SLOTS[moveIndex].damage}% DMG`
}

export function isBasicAttack(moveIndex: MoveIndex): boolean {
  return moveIndex === BASIC_ATTACK_INDEX
}
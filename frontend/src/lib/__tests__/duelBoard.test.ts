import { describe, it, expect } from 'vitest'
import {
  BASIC_ATTACK_INDEX,
  MOVE_NAMES_BY_TYPE,
  MOVE_SLOTS,
  TURN_TIMEOUT_SECONDS,
  isBasicAttack,
  moveDamageLabel,
  moveNameForType,
} from '../duelBoard'

// The 18 canonical Pokémon types (mirrors TeamSelectScreen's TYPE_LABELS —
// the frontend has no shared type-list module to import instead).
const CANONICAL_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark',
  'steel', 'fairy',
]

describe('MOVE_SLOTS', () => {
  it('defines exactly 4 moves with the fixed damage table 25/20/15/10', () => {
    expect(MOVE_SLOTS).toHaveLength(4)
    expect(MOVE_SLOTS.map((slot) => slot.damage)).toEqual([25, 20, 15, 10])
  })

  it('labels every move with a non-empty name', () => {
    for (const slot of MOVE_SLOTS) {
      expect(slot.name.length).toBeGreaterThan(0)
    }
  })
})

describe('moveDamageLabel', () => {
  it('formats the damage percentage for each move slot', () => {
    expect(moveDamageLabel(0)).toBe('25% DMG')
    expect(moveDamageLabel(1)).toBe('20% DMG')
    expect(moveDamageLabel(2)).toBe('15% DMG')
    expect(moveDamageLabel(3)).toBe('10% DMG')
  })
})

describe('basic attack contract', () => {
  it('binds the timeout auto-attack to the weakest 10% move', () => {
    expect(MOVE_SLOTS[BASIC_ATTACK_INDEX].damage).toBe(10)
  })

  it('flags only the basic attack index as basic', () => {
    expect(isBasicAttack(BASIC_ATTACK_INDEX)).toBe(true)
    expect(isBasicAttack(0)).toBe(false)
    expect(isBasicAttack(2)).toBe(false)
  })

  it('matches the server turn window of 10s (RF-6.1; backend DEFAULT_TURN_TIMEOUT_MS = 10_000)', () => {
    expect(TURN_TIMEOUT_SECONDS).toBe(10)
  })
})

describe('MOVE_NAMES_BY_TYPE / moveNameForType', () => {
  it('covers all 18 canonical types with 4 non-empty names each', () => {
    for (const type of CANONICAL_TYPES) {
      const names = MOVE_NAMES_BY_TYPE[type]
      expect(names, `missing themed move names for type "${type}"`).toBeDefined()
      expect(names).toHaveLength(4)
      for (const name of names) {
        expect(name.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the basic-attack slot (index 3) as ATAQUE BÁSICO for every type', () => {
    for (const type of CANONICAL_TYPES) {
      expect(MOVE_NAMES_BY_TYPE[type][BASIC_ATTACK_INDEX]).toBe('ATAQUE BÁSICO')
    }
  })

  it('resolves the themed name for a known type', () => {
    expect(moveNameForType('electric', 0)).toBe('RAYO')
    expect(moveNameForType('water', 1)).toBe('SURF')
  })

  it('falls back to the generic MOVE_SLOTS name for an unknown or missing type', () => {
    expect(moveNameForType('cosmic', 0)).toBe(MOVE_SLOTS[0].name)
    expect(moveNameForType(undefined, 2)).toBe(MOVE_SLOTS[2].name)
  })
})
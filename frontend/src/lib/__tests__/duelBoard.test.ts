import { describe, it, expect } from 'vitest'
import {
  BASIC_ATTACK_INDEX,
  MOVE_SLOTS,
  TURN_TIMEOUT_SECONDS,
  isBasicAttack,
  moveDamageLabel,
} from '../duelBoard'

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
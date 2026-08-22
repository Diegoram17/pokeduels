import { describe, it, expect } from 'vitest'
import { computeDamage } from '../damage'

describe('computeDamage', () => {
  it('returns 25% damage for move index 0', () => {
    expect(computeDamage(0)).toBe(25)
  })

  it('returns 20% damage for move index 1', () => {
    expect(computeDamage(1)).toBe(20)
  })

  it('returns 15% damage for move index 2', () => {
    expect(computeDamage(2)).toBe(15)
  })

  it('returns 10% damage for move index 3', () => {
    expect(computeDamage(3)).toBe(10)
  })
})
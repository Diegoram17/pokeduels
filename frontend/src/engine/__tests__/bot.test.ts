import { describe, it, expect } from 'vitest'
import { chooseBotMove } from '../bot'

describe('chooseBotMove', () => {
  it('returns a valid move index (0-3) over 1000 iterations', () => {
    for (let i = 0; i < 1000; i++) {
      const move = chooseBotMove()
      expect(move).toBeGreaterThanOrEqual(0)
      expect(move).toBeLessThanOrEqual(3)
      expect(Number.isInteger(move)).toBe(true)
    }
  })

  it('spreads across all four moves (no single fixed choice)', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      seen.add(chooseBotMove())
    }
    // With 1000 samples all four moves should appear; proves it is not
    // hardcoded to one index.
    expect(seen.size).toBe(4)
  })
})
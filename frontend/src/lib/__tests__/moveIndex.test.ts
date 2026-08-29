import { describe, it, expect } from 'vitest'
import { fromWireMoveIndex, toWireMoveIndex } from '../moveIndex'
import { BASIC_ATTACK_INDEX } from '../duelBoard'

const CLIENT_INDICES = [0, 1, 2, 3] as const
const WIRE_INDICES = [1, 2, 3, 4] as const

describe('toWireMoveIndex', () => {
  it('maps every 0-based client move to its 1-based wire form', () => {
    expect(toWireMoveIndex(0)).toBe(1)
    expect(toWireMoveIndex(1)).toBe(2)
    expect(toWireMoveIndex(2)).toBe(3)
    expect(toWireMoveIndex(3)).toBe(4)
  })

  it('maps the basic-attack boundary slot to wire index 4', () => {
    expect(toWireMoveIndex(BASIC_ATTACK_INDEX)).toBe(4)
  })
})

describe('fromWireMoveIndex', () => {
  it('maps every 1-based wire move back to its 0-based client form', () => {
    expect(fromWireMoveIndex(1)).toBe(0)
    expect(fromWireMoveIndex(2)).toBe(1)
    expect(fromWireMoveIndex(3)).toBe(2)
    expect(fromWireMoveIndex(4)).toBe(3)
  })

  it('accepts the full 1..4 wire range including the basic-attack boundary', () => {
    for (const n of WIRE_INDICES) {
      expect(fromWireMoveIndex(n)).toBe(n - 1)
    }
  })
})

describe('wire-index round-trip', () => {
  it('round-trips every client move index through the wire boundary', () => {
    for (const i of CLIENT_INDICES) {
      expect(fromWireMoveIndex(toWireMoveIndex(i))).toBe(i)
    }
  })

  it('round-trips every wire index back to the same wire index', () => {
    for (const n of WIRE_INDICES) {
      expect(toWireMoveIndex(fromWireMoveIndex(n))).toBe(n)
    }
  })
})
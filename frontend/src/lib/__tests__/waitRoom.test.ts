import { describe, it, expect } from 'vitest'
import type { RoomState } from '../../state/schema'
import { slotLabel, buildPlayerList, semifinalPairings } from '../waitRoom'

const room1v1: RoomState = {
  code: 'AB12',
  mode: '1v1',
  maxPlayers: 2,
  status: 'waiting',
  players: ['Ash'],
}

const roomTournament: RoomState = {
  code: 'Z009',
  mode: 'tournament',
  maxPlayers: 4,
  status: 'waiting',
  players: ['Ash'],
}

const fullRoom: RoomState = {
  code: 'Z009',
  mode: 'tournament',
  maxPlayers: 4,
  status: 'waiting',
  players: ['Ash', 'Brock', 'Misty', 'Red'],
}

describe('slotLabel', () => {
  it('labels each tournament slot', () => {
    expect(slotLabel('semiA')).toBe('SEMIFINAL A')
    expect(slotLabel('semiB')).toBe('SEMIFINAL B')
    expect(slotLabel('thirdPlace')).toBe('3ER PUESTO')
    expect(slotLabel('final')).toBe('FINAL')
  })
})

describe('buildPlayerList', () => {
  it('fills a 1v1 room with one bot', () => {
    const list = buildPlayerList(room1v1)
    expect(list).toEqual([
      { name: 'Ash', isBot: false },
      { name: 'VORTEX_99', isBot: true },
    ])
  })

  it('fills a tournament room with three bots', () => {
    const list = buildPlayerList(roomTournament)
    expect(list).toHaveLength(4)
    expect(list[0]).toEqual({ name: 'Ash', isBot: false })
    expect(list.filter((entry) => entry.isBot)).toHaveLength(3)
  })

  it('adds no bots when the room is already full', () => {
    const list = buildPlayerList(fullRoom)
    expect(list).toHaveLength(4)
    expect(list.filter((entry) => entry.isBot)).toHaveLength(0)
  })
})

describe('semifinalPairings', () => {
  it('pairs the four players into the two semifinals in order', () => {
    expect(semifinalPairings(['A', 'B', 'C', 'D'])).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ])
  })
})
import { describe, it, expect } from 'vitest'
import type { RoomState } from '../../state/schema'
import { slotLabel, buildPlayerList, semifinalPairings } from '../waitRoom'

const room1v1: RoomState = {
  code: 'AB12',
  maxPlayers: 2,
  status: 'waiting',
  players: [{ playerId: 'p1', nickname: 'Ash', ready: false, connected: true }],
}

const roomTournament: RoomState = {
  code: 'Z009',
  maxPlayers: 4,
  status: 'waiting',
  players: [{ playerId: 'p1', nickname: 'Ash', ready: false, connected: true }],
}

const fullRoom: RoomState = {
  code: 'Z009',
  maxPlayers: 4,
  status: 'waiting',
  players: [
    { playerId: 'p1', nickname: 'Ash', ready: false, connected: true },
    { playerId: 'p2', nickname: 'Brock', ready: false, connected: true },
    { playerId: 'p3', nickname: 'Misty', ready: false, connected: true },
    { playerId: 'p4', nickname: 'Red', ready: false, connected: true },
  ],
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
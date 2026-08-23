import { describe, it, expect } from 'vitest'
import type { RoomState } from '../../state/schema'
import {
  normalizeRoomCode,
  matchesRoomCode,
  roomMode,
  roomModeLabel,
  roomStatusLabel,
} from '../rooms'

const room: RoomState = {
  code: 'AB12',
  maxPlayers: 2,
  status: 'waiting',
  players: [],
}

describe('normalizeRoomCode', () => {
  it('trims and uppercases the typed code', () => {
    expect(normalizeRoomCode('  ab12 ')).toBe('AB12')
  })
})

describe('matchesRoomCode', () => {
  it('matches when the typed code equals the room code', () => {
    expect(matchesRoomCode('ab12', room)).toBe(true)
  })

  it('does not match a different code', () => {
    expect(matchesRoomCode('ZZ99', room)).toBe(false)
  })

  it('never matches when there is no room in state', () => {
    expect(matchesRoomCode('AB12', null)).toBe(false)
  })
})

describe('roomMode', () => {
  it('derives 1v1 from maxPlayers 2', () => {
    expect(roomMode(2)).toBe('1v1')
  })

  it('derives tournament from maxPlayers 4', () => {
    expect(roomMode(4)).toBe('tournament')
  })
})

describe('roomModeLabel', () => {
  it('labels a 1v1 room', () => {
    expect(roomModeLabel('1v1')).toBe('DUELO 1V1')
  })

  it('labels a tournament room', () => {
    expect(roomModeLabel('tournament')).toBe('TORNEO DE 4')
  })
})

describe('roomStatusLabel', () => {
  it('labels the waiting status', () => {
    expect(roomStatusLabel('waiting')).toBe('ESPERANDO ENTRENADORES')
  })

  it('labels the in-progress status', () => {
    expect(roomStatusLabel('in_progress')).toBe('EN COMBATE')
  })

  it('labels the finished status', () => {
    expect(roomStatusLabel('finished')).toBe('FINALIZADA')
  })
})
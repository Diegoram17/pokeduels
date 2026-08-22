import { describe, it, expect } from 'vitest'
import { toggleStarter, toggleRoster, isTeamComplete } from '../teamSelection'

describe('toggleStarter', () => {
  it('picks a starter when none is selected', () => {
    expect(toggleStarter(null, 'pikachu')).toBe('pikachu')
  })

  it('deselects the starter when the same one is clicked again', () => {
    expect(toggleStarter('pikachu', 'pikachu')).toBeNull()
  })

  it('blocks picking a different starter while one is selected', () => {
    expect(toggleStarter('pikachu', 'charmander')).toBe('pikachu')
  })
})

describe('toggleRoster', () => {
  it('adds a pokemon to the roster', () => {
    expect(toggleRoster([], 'a')).toEqual(['a'])
  })

  it('removes a pokemon already in the roster', () => {
    expect(toggleRoster(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('does not add a sixth pokemon when the roster is full', () => {
    const full = ['a', 'b', 'c', 'd', 'e']
    expect(toggleRoster(full, 'f')).toEqual(full)
  })

  it('keeps insertion order of the picks', () => {
    expect(toggleRoster(['a'], 'b')).toEqual(['a', 'b'])
  })
})

describe('isTeamComplete', () => {
  it('is complete with a starter and exactly 5 roster picks', () => {
    expect(isTeamComplete('pikachu', ['a', 'b', 'c', 'd', 'e'])).toBe(true)
  })

  it('is incomplete without a starter', () => {
    expect(isTeamComplete(null, ['a', 'b', 'c', 'd', 'e'])).toBe(false)
  })

  it('is incomplete with fewer than 5 roster picks', () => {
    expect(isTeamComplete('pikachu', ['a', 'b'])).toBe(false)
  })
})
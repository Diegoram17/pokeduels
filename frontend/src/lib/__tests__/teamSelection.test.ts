import { describe, it, expect } from 'vitest'
import { toggleStarter, toggleRoster, isTeamComplete } from '../teamSelection'

describe('toggleStarter', () => {
  it('picks a starter when none is selected', () => {
    expect(toggleStarter(null, 25)).toBe(25)
  })

  it('deselects the starter when the same one is clicked again', () => {
    expect(toggleStarter(25, 25)).toBeNull()
  })

  it('blocks picking a different starter while one is selected', () => {
    expect(toggleStarter(25, 4)).toBe(25)
  })
})

describe('toggleRoster', () => {
  it('adds a pokemon to the roster', () => {
    expect(toggleRoster([], 25)).toEqual([25])
  })

  it('removes a pokemon already in the roster', () => {
    expect(toggleRoster([25, 133], 25)).toEqual([133])
  })

  it('does not add a sixth pokemon when the roster is full', () => {
    const full = [1, 2, 3, 4, 5]
    expect(toggleRoster(full, 6)).toEqual(full)
  })

  it('keeps insertion order of the picks', () => {
    expect(toggleRoster([25], 133)).toEqual([25, 133])
  })
})

describe('isTeamComplete', () => {
  it('is complete with a starter and exactly 5 roster picks', () => {
    expect(isTeamComplete(25, [1, 2, 3, 4, 5])).toBe(true)
  })

  it('is incomplete without a starter', () => {
    expect(isTeamComplete(null, [1, 2, 3, 4, 5])).toBe(false)
  })

  it('is incomplete with fewer than 5 roster picks', () => {
    expect(isTeamComplete(25, [1, 2])).toBe(false)
  })
})
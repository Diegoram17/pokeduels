import { describe, it, expect } from 'vitest'
import {
  createInitialState,
  serializeMockState,
  parseMockState,
  loadMockState,
  saveMockState,
  reduceMockState,
  STORAGE_KEY,
  type StorageLike,
} from '../store'
import type { MockState } from '../schema'

function makeMemoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

describe('createInitialState', () => {
  it('starts with empty player, no room, no team, no duel', () => {
    const s = createInitialState()
    expect(s.player.nickname).toBe('')
    expect(s.room).toBeNull()
    expect(s.teamSelection).toEqual({ starterId: null, rosterIds: [] })
    expect(s.tournament).toBeNull()
    expect(s.duelPokemonState).toHaveLength(0)
    expect(s.duel).toBeNull()
  })
})

describe('serializeMockState / parseMockState', () => {
  it('round-trips a non-trivial state through serialize and parse', () => {
    const state: MockState = {
      player: { nickname: 'Ash' },
      room: {
        code: 'AB12',
        mode: 'tournament',
        maxPlayers: 4,
        status: 'waiting',
        players: ['Ash'],
      },
      teamSelection: { starterId: 'pikachu', rosterIds: ['a', 'b', 'c', 'd', 'e'] },
      tournament: {
        bracket: { semiA: null, semiB: null },
        queue: ['semiA', 'semiB'],
        activeSlot: 'semiA',
        results: {},
      },
      duelPokemonState: [],
      duel: null,
    }
    const parsed = parseMockState(serializeMockState(state))
    expect(parsed).toEqual(state)
  })

  it('returns null for a version mismatch', () => {
    const raw = JSON.stringify({ _v: 999, state: createInitialState() })
    expect(parseMockState(raw)).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    expect(parseMockState('not-json')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(parseMockState(null)).toBeNull()
  })
})

describe('loadMockState / saveMockState', () => {
  it('loads the stored state after a save', () => {
    const storage = makeMemoryStorage()
    const state: MockState = {
      ...createInitialState(),
      player: { nickname: 'Misty' },
    }
    saveMockState(state, storage)
    expect(loadMockState(storage)).toEqual(state)
  })

  it('falls back to the initial state when storage is empty', () => {
    const storage = makeMemoryStorage()
    expect(loadMockState(storage)).toEqual(createInitialState())
  })

  it('writes under the pokeduels:mockState key', () => {
    const storage = makeMemoryStorage()
    saveMockState(createInitialState(), storage)
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull()
  })
})

describe('reduceMockState — setNickname', () => {
  it('sets the player nickname', () => {
    const s = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Ash',
    })
    expect(s.player.nickname).toBe('Ash')
  })
})

describe('reduceMockState — createRoom', () => {
  it('creates a 1v1 room with the player listed', () => {
    const base = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Ash',
    })
    const s = reduceMockState(base, { type: 'createRoom', mode: '1v1', maxPlayers: 2 })
    expect(s.room?.mode).toBe('1v1')
    expect(s.room?.maxPlayers).toBe(2)
    expect(s.room?.status).toBe('waiting')
    expect(s.room?.players).toEqual(['Ash'])
    expect(s.room?.code).toMatch(/^[A-Z0-9]{4}$/)
    expect(s.tournament).toBeNull()
  })

  it('creates a tournament room and seeds the semi-final queue', () => {
    const base = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Ash',
    })
    const s = reduceMockState(base, {
      type: 'createRoom',
      mode: 'tournament',
      maxPlayers: 4,
    })
    expect(s.room?.mode).toBe('tournament')
    expect(s.room?.maxPlayers).toBe(4)
    expect(s.tournament?.queue).toEqual(['semiA', 'semiB'])
    expect(s.tournament?.activeSlot).toBe('semiA')
    expect(s.tournament?.results).toEqual({})
  })
})

describe('reduceMockState — joinRoom', () => {
  it('adds the player to the room when the code matches', () => {
    const base = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Ash',
    })
    const withRoom = reduceMockState(base, {
      type: 'createRoom',
      mode: '1v1',
      maxPlayers: 2,
    })
    const code = withRoom.room!.code
    const s = reduceMockState(withRoom, { type: 'joinRoom', code })
    expect(s.room?.players).toContain('Ash')
  })

  it('leaves the state unchanged when the code does not match', () => {
    const base = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Ash',
    })
    const withRoom = reduceMockState(base, {
      type: 'createRoom',
      mode: '1v1',
      maxPlayers: 2,
    })
    const s = reduceMockState(withRoom, { type: 'joinRoom', code: 'ZZ99' })
    expect(s.room).toEqual(withRoom.room)
  })
})

describe('reduceMockState — updateTeamSelection', () => {
  it('merges partial team selection updates', () => {
    const base = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Ash',
    })
    const s1 = reduceMockState(base, {
      type: 'updateTeamSelection',
      selection: { starterId: 'pikachu' },
    })
    expect(s1.teamSelection.starterId).toBe('pikachu')
    const s2 = reduceMockState(s1, {
      type: 'updateTeamSelection',
      selection: { rosterIds: ['a', 'b', 'c', 'd', 'e'] },
    })
    expect(s2.teamSelection.starterId).toBe('pikachu')
    expect(s2.teamSelection.rosterIds).toHaveLength(5)
  })
})

function makeTeamState(): MockState {
  let s = reduceMockState(createInitialState(), {
    type: 'setNickname',
    nickname: 'Ash',
  })
  s = reduceMockState(s, { type: 'createRoom', mode: '1v1', maxPlayers: 2 })
  s = reduceMockState(s, {
    type: 'updateTeamSelection',
    selection: {
      starterId: 'pikachu',
      rosterIds: ['a', 'b', 'c', 'd', 'e'],
    },
  })
  return s
}

describe('reduceMockState — enterDuel', () => {
  it('builds a 6v6 duel with the starter active', () => {
    const s = reduceMockState(makeTeamState(), { type: 'enterDuel', slot: '1v1' })
    expect(s.duel?.slot).toBe('1v1')
    expect(s.duel?.phase).toBe('awaiting_actions')
    expect(s.duel?.turnNumber).toBe(1)
    expect(s.duelPokemonState).toHaveLength(12)
    const humanActive = s.duelPokemonState.find(
      (p) => p.ownerId === 'Ash' && p.isActive,
    )
    expect(humanActive?.pokemonId).toBe('pikachu')
    expect(s.duelPokemonState.filter((p) => p.currentHp === 100)).toHaveLength(12)
  })

  it('is a no-op without a complete team', () => {
    let s = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Ash',
    })
    s = reduceMockState(s, { type: 'createRoom', mode: '1v1', maxPlayers: 2 })
    s = reduceMockState(s, {
      type: 'updateTeamSelection',
      selection: { starterId: 'pikachu', rosterIds: ['a', 'b'] },
    })
    const after = reduceMockState(s, { type: 'enterDuel', slot: '1v1' })
    expect(after.duel).toBeNull()
    expect(after.duelPokemonState).toHaveLength(0)
  })
})

describe('reduceMockState — applyPlayerAttack', () => {
  it('applies human damage to the bot active pokemon', () => {
    const inDuel = reduceMockState(makeTeamState(), {
      type: 'enterDuel',
      slot: '1v1',
    })
    const s = reduceMockState(inDuel, { type: 'applyPlayerAttack', moveIndex: 0 })
    const botActive = s.duelPokemonState.find(
      (p) => p.ownerId !== 'Ash' && p.isActive,
    )
    expect(botActive?.currentHp).toBe(75)
    expect(s.duel?.turnNumber).toBe(2)
  })

  it('is a no-op when no duel is active', () => {
    const s = reduceMockState(createInitialState(), {
      type: 'applyPlayerAttack',
      moveIndex: 0,
    })
    expect(s).toEqual(createInitialState())
  })
})

describe('reduceMockState — confirmSwap', () => {
  it('activates the chosen bench pokemon and resumes actions', () => {
    const inDuel = reduceMockState(makeTeamState(), {
      type: 'enterDuel',
      slot: '1v1',
    })
    const s = reduceMockState(inDuel, { type: 'confirmSwap', pokemonId: 'a' })
    const humanActive = s.duelPokemonState.find(
      (p) => p.ownerId === 'Ash' && p.isActive,
    )
    expect(humanActive?.pokemonId).toBe('a')
    expect(s.duel?.phase).toBe('awaiting_actions')
    const oldStarter = s.duelPokemonState.find(
      (p) => p.ownerId === 'Ash' && p.pokemonId === 'pikachu',
    )
    expect(oldStarter?.isActive).toBe(false)
  })
})

describe('reduceMockState — surrender', () => {
  it('finishes the duel with the bot as winner', () => {
    const inDuel = reduceMockState(makeTeamState(), {
      type: 'enterDuel',
      slot: '1v1',
    })
    const s = reduceMockState(inDuel, { type: 'surrender' })
    expect(s.duel?.phase).toBe('finished')
    expect(s.duel?.endReason).toBe('surrender')
    expect(s.duel?.winnerId).not.toBe('Ash')
  })
})

describe('reduceMockState — advanceTournament', () => {
  it('records the finished duel result and advances the queue', () => {
    let s = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Ash',
    })
    s = reduceMockState(s, {
      type: 'createRoom',
      mode: 'tournament',
      maxPlayers: 4,
    })
    s = reduceMockState(s, {
      type: 'updateTeamSelection',
      selection: {
        starterId: 'pikachu',
        rosterIds: ['a', 'b', 'c', 'd', 'e'],
      },
    })
    s = reduceMockState(s, { type: 'enterDuel', slot: 'semiA' })
    // Simulate a finished duel where the human won.
    const finished: MockState = {
      ...s,
      duel: { ...s.duel!, phase: 'finished', winnerId: 'Ash', endReason: 'ko' },
    }
    const after = reduceMockState(finished, { type: 'advanceTournament' })
    expect(after.tournament?.results.semiA).toEqual({
      winner: 'Ash',
      loser: expect.any(String),
    })
    expect(after.tournament?.activeSlot).toBe('semiB')
  })

  it('is a no-op without a tournament', () => {
    const inDuel = reduceMockState(makeTeamState(), {
      type: 'enterDuel',
      slot: '1v1',
    })
    const finished: MockState = {
      ...inDuel,
      duel: { ...inDuel.duel!, phase: 'finished', winnerId: 'Ash', endReason: 'ko' },
    }
    const after = reduceMockState(finished, { type: 'advanceTournament' })
    expect(after.tournament).toBeNull()
  })
})
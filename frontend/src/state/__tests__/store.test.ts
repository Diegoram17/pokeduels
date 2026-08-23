import { describe, it, expect, beforeEach } from 'vitest'
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
import { setCachedCatalog } from '../../lib/catalog'
import type { Pokemon } from '../../lib/catalog'

const duelCatalog: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'front-pikachu', back_sprite_url: 'back-pikachu', is_starter: true },
  { id: 5, name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'front-snorlax', back_sprite_url: 'back-snorlax', is_starter: false },
  { id: 6, name: 'Eevee', type: 'normal', pokeapi_id: 133, sprite_url: 'front-eevee', back_sprite_url: 'back-eevee', is_starter: false },
  { id: 23, name: 'Pidgeot', type: 'flying', pokeapi_id: 18, sprite_url: 'front-pidgeot', back_sprite_url: 'back-pidgeot', is_starter: false },
  { id: 14, name: 'Sceptile', type: 'grass', pokeapi_id: 254, sprite_url: 'front-sceptile', back_sprite_url: 'back-sceptile', is_starter: false },
  { id: 17, name: 'Machamp', type: 'fighting', pokeapi_id: 68, sprite_url: 'front-machamp', back_sprite_url: 'back-machamp', is_starter: false },
  { id: 33, name: 'Onix', type: 'rock', pokeapi_id: 95, sprite_url: 'front-onix', back_sprite_url: 'back-onix', is_starter: false },
  { id: 15, name: 'Gengar', type: 'ghost', pokeapi_id: 94, sprite_url: 'front-gengar', back_sprite_url: 'back-gengar', is_starter: false },
]

beforeEach(() => {
  setCachedCatalog(null)
})

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
      player: { nickname: 'Ash', playerId: null, sessionToken: null },
      room: {
        code: 'AB12',
        maxPlayers: 4,
        status: 'waiting',
        players: [{ playerId: 'p1', nickname: 'Ash', ready: false, connected: true }],
      },
      teamSelection: { starterId: 25, rosterIds: [5, 23, 14, 17, 33] },
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
      player: { nickname: 'Ash', playerId: null, sessionToken: null },
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

describe('reduceMockState — sessionEstablished', () => {
  it('stores the playerId, sessionToken and nickname from the backend session', () => {
    const s = reduceMockState(createInitialState(), {
      type: 'sessionEstablished',
      playerId: 'player-1',
      sessionToken: 'token-1',
      nickname: 'Ash',
    })
    expect(s.player).toEqual({
      nickname: 'Ash',
      playerId: 'player-1',
      sessionToken: 'token-1',
    })
  })

  it('overwrites a previously set nickname with the session nickname', () => {
    const base = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Old',
    })
    const s = reduceMockState(base, {
      type: 'sessionEstablished',
      playerId: 'player-2',
      sessionToken: 'token-2',
      nickname: 'Ash',
    })
    expect(s.player.nickname).toBe('Ash')
    expect(s.player.playerId).toBe('player-2')
    expect(s.player.sessionToken).toBe('token-2')
  })
})

describe('reduceMockState — roomShellReceived', () => {
  it('stores a 1v1 room shell with an empty roster and no tournament', () => {
    const base = reduceMockState(createInitialState(), {
      type: 'sessionEstablished',
      playerId: 'p1',
      sessionToken: 't1',
      nickname: 'Ash',
    })
    const s = reduceMockState(base, {
      type: 'roomShellReceived',
      code: 'AB12',
      maxPlayers: 2,
      status: 'waiting',
    })
    expect(s.room).toEqual({
      code: 'AB12',
      maxPlayers: 2,
      status: 'waiting',
      players: [],
    })
    expect(s.tournament).toBeNull()
  })

  it('stores a tournament room shell and seeds the semi-final queue', () => {
    const base = reduceMockState(createInitialState(), {
      type: 'sessionEstablished',
      playerId: 'p1',
      sessionToken: 't1',
      nickname: 'Ash',
    })
    const s = reduceMockState(base, {
      type: 'roomShellReceived',
      code: 'Z009',
      maxPlayers: 4,
      status: 'waiting',
    })
    expect(s.room?.maxPlayers).toBe(4)
    expect(s.room?.code).toBe('Z009')
    expect(s.tournament?.queue).toEqual(['semiA', 'semiB'])
    expect(s.tournament?.activeSlot).toBe('semiA')
    expect(s.tournament?.results).toEqual({})
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
      selection: { starterId: 25 },
    })
    expect(s1.teamSelection.starterId).toBe(25)
    const s2 = reduceMockState(s1, {
      type: 'updateTeamSelection',
      selection: { rosterIds: [5, 23, 14, 17, 33] },
    })
    expect(s2.teamSelection.starterId).toBe(25)
    expect(s2.teamSelection.rosterIds).toHaveLength(5)
  })
})

function makeTeamState(): MockState {
  let s = reduceMockState(createInitialState(), {
    type: 'setNickname',
    nickname: 'Ash',
  })
  s = reduceMockState(s, {
    type: 'roomShellReceived',
    code: 'AB12',
    maxPlayers: 2,
    status: 'waiting',
  })
  s = reduceMockState(s, {
    type: 'updateTeamSelection',
    selection: {
      starterId: 25,
      rosterIds: [5, 23, 14, 17, 33],
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
    expect(humanActive?.pokemonId).toBe('25')
    expect(s.duelPokemonState.filter((p) => p.currentHp === 100)).toHaveLength(12)
  })

  it('is a no-op without a complete team', () => {
    let s = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Ash',
    })
    s = reduceMockState(s, {
      type: 'roomShellReceived',
      code: 'AB12',
      maxPlayers: 2,
      status: 'waiting',
    })
    s = reduceMockState(s, {
      type: 'updateTeamSelection',
      selection: { starterId: 25, rosterIds: [5, 23] },
    })
    const after = reduceMockState(s, { type: 'enterDuel', slot: '1v1' })
    expect(after.duel).toBeNull()
    expect(after.duelPokemonState).toHaveLength(0)
  })
})

describe('reduceMockState — enterDuel resolves real catalog data', () => {
  it('populates name, type and both sprite urls from the catalog when loaded', () => {
    setCachedCatalog(duelCatalog)
    const s = reduceMockState(makeTeamState(), { type: 'enterDuel', slot: '1v1' })
    const humanActive = s.duelPokemonState.find(
      (p) => p.ownerId === 'Ash' && p.isActive,
    )
    expect(humanActive?.name).toBe('Pikachu')
    expect(humanActive?.type).toBe('electric')
    expect(humanActive?.spriteUrl).toBe('front-pikachu')
    expect(humanActive?.backSpriteUrl).toBe('back-pikachu')
    // Unknown roster ids keep the stub shape instead of crashing the duel.
    const fakeRoster = s.duelPokemonState.find((p) => p.pokemonId === '5')
    expect(fakeRoster?.name).toBe('Snorlax')
    expect(fakeRoster?.spriteUrl).toBe('front-snorlax')
  })

  it('resolves the bot roster through the catalog (numeric ids)', () => {
    setCachedCatalog(duelCatalog)
    const s = reduceMockState(makeTeamState(), { type: 'enterDuel', slot: '1v1' })
    const botActive = s.duelPokemonState.find(
      (p) => p.ownerId === 'bot' && p.isActive,
    )
    expect(botActive?.name).toBe('Eevee')
    expect(botActive?.type).toBe('normal')
    expect(botActive?.spriteUrl).toBe('front-eevee')
    expect(botActive?.backSpriteUrl).toBe('back-eevee')
    expect(s.duelPokemonState.filter((p) => p.ownerId === 'bot')).toHaveLength(6)
  })

  it('falls back to the stub shape when the catalog is not loaded yet', () => {
    const s = reduceMockState(makeTeamState(), { type: 'enterDuel', slot: '1v1' })
    const humanActive = s.duelPokemonState.find(
      (p) => p.ownerId === 'Ash' && p.isActive,
    )
    expect(humanActive?.name).toBe('25')
    expect(humanActive?.type).toBe('normal')
    expect(humanActive?.spriteUrl).toBe('')
    expect(humanActive?.backSpriteUrl).toBe('')
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
    const s = reduceMockState(inDuel, { type: 'confirmSwap', pokemonId: '5' })
    const humanActive = s.duelPokemonState.find(
      (p) => p.ownerId === 'Ash' && p.isActive,
    )
    expect(humanActive?.pokemonId).toBe('5')
    expect(s.duel?.phase).toBe('awaiting_actions')
    const oldStarter = s.duelPokemonState.find(
      (p) => p.ownerId === 'Ash' && p.pokemonId === '25',
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
      type: 'roomShellReceived',
      code: 'Z009',
      maxPlayers: 4,
      status: 'waiting',
    })
    s = reduceMockState(s, {
      type: 'updateTeamSelection',
      selection: {
        starterId: 25,
        rosterIds: [5, 23, 14, 17, 33],
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

describe('reduceMockState — resetSession', () => {
  it('clears the room, tournament, team and duel but keeps the nickname', () => {
    let s = reduceMockState(createInitialState(), {
      type: 'setNickname',
      nickname: 'Ash',
    })
    s = reduceMockState(s, {
      type: 'roomShellReceived',
      code: 'Z009',
      maxPlayers: 4,
      status: 'waiting',
    })
    s = reduceMockState(s, {
      type: 'updateTeamSelection',
      selection: { starterId: 25, rosterIds: [5, 23, 14, 17, 33] },
    })
    s = reduceMockState(s, { type: 'enterDuel', slot: 'semiA' })

    const after = reduceMockState(s, { type: 'resetSession' })

    expect(after.player.nickname).toBe('Ash')
    expect(after.room).toBeNull()
    expect(after.tournament).toBeNull()
    expect(after.teamSelection).toEqual({ starterId: null, rosterIds: [] })
    expect(after.duel).toBeNull()
    expect(after.duelPokemonState).toHaveLength(0)
  })
})
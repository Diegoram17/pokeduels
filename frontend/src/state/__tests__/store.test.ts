import { describe, it, expect, beforeEach } from 'vitest'
import {
  createInitialState,
  serializeMockState,
  parseMockState,
  loadMockState,
  saveMockState,
  reduceMockState,
  toDuelPokemonState,
  deriveDuelSlot,
  deriveDuelPhase,
  duelFromSnapshot,
  type DuelSnapshot,
  STORAGE_KEY,
  type StorageLike,
} from '../store'
import type { AttackEvent, DuelState, MockState, TournamentState } from '../schema'
import { setCachedCatalog } from '../../lib/catalog'
import type { Pokemon } from '../../lib/catalog'

const duelCatalog: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'front-pikachu', back_sprite_url: 'back-pikachu', is_starter: true },
  { id: 5, name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'front-snorlax', back_sprite_url: 'back-snorlax', is_starter: false },
  { id: 6, name: 'Eevee', type: 'normal', pokeapi_id: 133, sprite_url: 'front-eevee', back_sprite_url: 'back-eevee', is_starter: false },
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

function makeDuelStateFixture(): MockState {
  let s = reduceMockState(createInitialState(), { type: 'setNickname', nickname: 'Ash' })
  s = reduceMockState(s, {
    type: 'roomShellReceived',
    code: 'AB12',
    maxPlayers: 2,
    status: 'waiting',
  })
  s = reduceMockState(s, {
    type: 'updateTeamSelection',
    selection: { starterId: 25, rosterIds: [5, 23, 14, 17, 33] },
  })
  s = reduceMockState(s, {
    type: 'duelStateReceived',
    duel: {
      duelId: '42',
      slot: '1v1',
      phase: 'awaiting_actions',
      turnNumber: 1,
      winnerId: null,
      endReason: null,
      opponentDisconnected: false,
      lastRejection: null,
    },
    duelPokemonState: [
      { duelId: '42', ownerId: 10, pokemonId: 25, name: 'Pikachu', type: 'electric', spriteUrl: 'front-pikachu', backSpriteUrl: 'back-pikachu', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
      { duelId: '42', ownerId: 11, pokemonId: 5, name: 'Snorlax', type: 'normal', spriteUrl: 'front-snorlax', backSpriteUrl: 'back-snorlax', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
    ],
  })
  return s
}

describe('createInitialState', () => {
  it('starts with empty player, no room, no team, no duel, no pending duel, no ranking', () => {
    const s = createInitialState()
    expect(s.player.nickname).toBe('')
    expect(s.room).toBeNull()
    expect(s.teamSelection).toEqual({ starterId: null, rosterIds: [] })
    expect(s.tournament).toBeNull()
    expect(s.duelPokemonState).toHaveLength(0)
    expect(s.duel).toBeNull()
    expect(s.pendingDuelId).toBeNull()
    expect(s.finalRanking).toBeNull()
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
      },
      duelPokemonState: [],
      duel: null,
      pendingDuelId: '42',
      finalRanking: [{ rank: 1, name: 'Ash', champion: true }],
      roomAborted: null,
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

  it('stores a tournament room shell without seeding a bracket (server pushes it later)', () => {
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
    expect(s.tournament).toBeNull()
  })

  it('resets room-scoped state when a new room shell arrives', () => {
    let s = makeDuelStateFixture()
    s = reduceMockState(s, {
      type: 'tournamentBracket',
      bracket: { semiA: { duelId: '42', playerA: '10', playerB: '11' } },
    })
    s = reduceMockState(s, { type: 'roomFinalRanking', ranking: [{ rank: 1, name: 'Ash', champion: true }] })
    s = reduceMockState(s, { type: 'pendingDuelSet', duelId: '42' })

    const after = reduceMockState(s, {
      type: 'roomShellReceived',
      code: 'NEW1',
      maxPlayers: 2,
      status: 'waiting',
    })
    expect(after.room?.code).toBe('NEW1')
    expect(after.tournament).toBeNull()
    expect(after.duel).toBeNull()
    expect(after.duelPokemonState).toHaveLength(0)
    expect(after.pendingDuelId).toBeNull()
    expect(after.finalRanking).toBeNull()
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

describe('reduceMockState — pendingDuelSet / pendingDuelClear', () => {
  it('records a server-announced duel as pending', () => {
    const s = reduceMockState(createInitialState(), { type: 'pendingDuelSet', duelId: '42' })
    expect(s.pendingDuelId).toBe('42')
  })

  it('clears the pending duel pointer', () => {
    let s = reduceMockState(createInitialState(), { type: 'pendingDuelSet', duelId: '42' })
    s = reduceMockState(s, { type: 'pendingDuelClear' })
    expect(s.pendingDuelId).toBeNull()
  })
})

describe('reduceMockState — duelStateReceived', () => {
  it('populates the duel and pokemon from the server snapshot and clears the pending pointer', () => {
    let s = reduceMockState(createInitialState(), { type: 'pendingDuelSet', duelId: '42' })
    s = reduceMockState(s, {
      type: 'duelStateReceived',
      duel: {
        duelId: '42',
        slot: 'semiA',
        phase: 'lead_selection',
        turnNumber: 1,
        winnerId: null,
        endReason: null,
        opponentDisconnected: false,
        lastRejection: null,
      },
      duelPokemonState: [
        { duelId: '42', ownerId: 10, pokemonId: 25, name: 'Pikachu', type: 'electric', spriteUrl: 'f', backSpriteUrl: 'b', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
        { duelId: '42', ownerId: 11, pokemonId: 5, name: 'Snorlax', type: 'normal', spriteUrl: 'f', backSpriteUrl: 'b', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
      ],
    })
    expect(s.duel?.duelId).toBe('42')
    expect(s.duel?.phase).toBe('lead_selection')
    expect(s.duelPokemonState).toHaveLength(2)
    expect(s.pendingDuelId).toBeNull()
  })
})

describe('reduceMockState — duelTurnResolved', () => {
  it('replaces the snapshot and clears the opponent-disconnect banner and the rejection', () => {
    const withBanner = reduceMockState(makeDuelStateFixture(), { type: 'duelOpponentDisconnected' })
    const withRejection = reduceMockState(withBanner, {
      type: 'duelActionRejected',
      moveIndex: 1,
      reason: 'insufficient_pp',
    })

    const resolved = reduceMockState(withRejection, {
      type: 'duelTurnResolved',
      duel: {
        duelId: '42',
        slot: '1v1',
        phase: 'awaiting_actions',
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        opponentDisconnected: false,
        lastRejection: null,
      },
      duelPokemonState: [
        { duelId: '42', ownerId: 10, pokemonId: 25, name: 'Pikachu', type: 'electric', spriteUrl: 'f', backSpriteUrl: 'b', currentHp: 75, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
        { duelId: '42', ownerId: 11, pokemonId: 5, name: 'Snorlax', type: 'normal', spriteUrl: 'f', backSpriteUrl: 'b', currentHp: 75, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
      ],
      attackSequence: null,
    })
    expect(resolved.duel?.turnNumber).toBe(2)
    expect(resolved.duel?.opponentDisconnected).toBe(false)
    expect(resolved.duel?.lastRejection).toBeNull()
    expect(resolved.duelPokemonState[0].currentHp).toBe(75)
  })

  it('stores the attackSequence on the resolved duel (Fase 7, PR8)', () => {
    const attackSequence: AttackEvent[] = [
      { type: 'resolved', playerId: 11, moveIndex: 2, damage: 25, effectiveness: 1, fainted: false },
      { type: 'resolved', playerId: 10, moveIndex: 4, damage: 10, effectiveness: 1, fainted: true },
    ]
    const resolved = reduceMockState(makeDuelStateFixture(), {
      type: 'duelTurnResolved',
      duel: {
        duelId: '42',
        slot: '1v1',
        phase: 'awaiting_actions',
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        opponentDisconnected: false,
        lastRejection: null,
      },
      duelPokemonState: [
        { duelId: '42', ownerId: 10, pokemonId: 25, name: 'Pikachu', type: 'electric', spriteUrl: 'f', backSpriteUrl: 'b', currentHp: 75, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
        { duelId: '42', ownerId: 11, pokemonId: 5, name: 'Snorlax', type: 'normal', spriteUrl: 'f', backSpriteUrl: 'b', currentHp: 75, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
      ],
      attackSequence,
    })
    expect(resolved.duel?.attackSequence).toEqual(attackSequence)
  })

  it('nulls the attackSequence on duelStateReceived so a resync never replays (Fase 7, PR8)', () => {
    const attackSequence: AttackEvent[] = [
      { type: 'resolved', playerId: 11, moveIndex: 2, damage: 25, effectiveness: 1, fainted: false },
    ]
    let s = reduceMockState(makeDuelStateFixture(), {
      type: 'duelTurnResolved',
      duel: {
        duelId: '42',
        slot: '1v1',
        phase: 'awaiting_actions',
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        opponentDisconnected: false,
        lastRejection: null,
      },
      duelPokemonState: [],
      attackSequence,
    })
    expect(s.duel?.attackSequence).toEqual(attackSequence)

    const resynced = reduceMockState(s, {
      type: 'duelStateReceived',
      duel: {
        duelId: '42',
        slot: '1v1',
        phase: 'awaiting_actions',
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        opponentDisconnected: false,
        lastRejection: null,
      },
      duelPokemonState: [],
    })
    expect(resynced.duel?.attackSequence).toBeNull()
  })

  it('nulls the attackSequence on duelFinished (Fase 7, PR8)', () => {
    const attackSequence: AttackEvent[] = [
      { type: 'resolved', playerId: 11, moveIndex: 2, damage: 25, effectiveness: 1, fainted: false },
    ]
    let s = reduceMockState(makeDuelStateFixture(), {
      type: 'duelTurnResolved',
      duel: {
        duelId: '42',
        slot: '1v1',
        phase: 'awaiting_actions',
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        opponentDisconnected: false,
        lastRejection: null,
      },
      duelPokemonState: [],
      attackSequence,
    })
    expect(s.duel?.attackSequence).toEqual(attackSequence)

    const finished = reduceMockState(s, {
      type: 'duelFinished',
      duelId: '42',
      winnerId: '11',
      endReason: 'ko',
    })
    expect(finished.duel?.attackSequence).toBeNull()
  })
})

describe('reduceMockState — duelFinished', () => {
  it('marks the duel finished with the server winner and end reason', () => {
    const s = reduceMockState(makeDuelStateFixture(), {
      type: 'duelFinished',
      duelId: '42',
      winnerId: '11',
      endReason: 'ko',
    })
    expect(s.duel?.phase).toBe('finished')
    expect(s.duel?.winnerId).toBe('11')
    expect(s.duel?.endReason).toBe('ko')
  })

  it('clears the opponent-disconnect banner on finish', () => {
    const withBanner = reduceMockState(makeDuelStateFixture(), { type: 'duelOpponentDisconnected' })
    const s = reduceMockState(withBanner, {
      type: 'duelFinished',
      duelId: '42',
      winnerId: '10',
      endReason: 'surrender',
    })
    expect(s.duel?.phase).toBe('finished')
    expect(s.duel?.opponentDisconnected).toBe(false)
  })

  it('is a no-op when the finished duel id does not match the active duel', () => {
    const s = reduceMockState(makeDuelStateFixture(), {
      type: 'duelFinished',
      duelId: '999',
      winnerId: '11',
      endReason: 'ko',
    })
    expect(s.duel?.phase).toBe('awaiting_actions')
    expect(s.duel?.winnerId).toBeNull()
  })
})

describe('reduceMockState — duelCleared', () => {
  it('drops the finished duel, its pokemon and the pending pointer, keeping room/player/team', () => {
    const finished = reduceMockState(makeDuelStateFixture(), {
      type: 'duelFinished',
      duelId: '42',
      winnerId: '10',
      endReason: 'ko',
    })
    expect(finished.duel?.phase).toBe('finished')

    const s = reduceMockState(finished, { type: 'duelCleared' })

    expect(s.duel).toBeNull()
    expect(s.duelPokemonState).toEqual([])
    expect(s.pendingDuelId).toBeNull()
    // A rematch re-picks the team, but the room seat and identity survive.
    expect(s.room?.code).toBe('AB12')
    expect(s.player.nickname).toBe('Ash')
    expect(s.teamSelection).toEqual(finished.teamSelection)
  })

  it('is a plain no-op when there is no duel', () => {
    const base = createInitialState()
    expect(reduceMockState(base, { type: 'duelCleared' })).toEqual(base)
  })
})

describe('reduceMockState — duelLeadSelection', () => {
  function makeLeadDuel(): MockState {
    return reduceMockState(makeDuelStateFixture(), {
      type: 'duelStateReceived',
      duel: {
        duelId: '42',
        slot: '1v1',
        phase: 'lead_selection',
        turnNumber: 1,
        winnerId: null,
        endReason: null,
        opponentDisconnected: false,
        lastRejection: null,
      },
      duelPokemonState: [
        { duelId: '42', ownerId: 10, pokemonId: 25, name: 'Pikachu', type: 'electric', spriteUrl: 'f', backSpriteUrl: 'b', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
        { duelId: '42', ownerId: 11, pokemonId: 5, name: 'Snorlax', type: 'normal', spriteUrl: 'f', backSpriteUrl: 'b', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
      ],
    })
  }

  it('activates the picked lead locally but keeps the lead_selection phase', () => {
    const s = reduceMockState(makeLeadDuel(), {
      type: 'duelLeadSelection',
      ownerId: 10,
      pokemonId: 25,
    })
    // Phase stays lead_selection — only the server's duel:state broadcast (once
    // BOTH leads are ready) advances it via deriveDuelPhase.
    expect(s.duel?.phase).toBe('lead_selection')
    expect(s.duelPokemonState.find((p) => p.ownerId === 10)?.isActive).toBe(true)
    expect(s.duelPokemonState.find((p) => p.ownerId === 11)?.isActive).toBe(false)
  })

  it('is a no-op once the duel is already past lead selection', () => {
    const s = reduceMockState(makeDuelStateFixture(), {
      type: 'duelLeadSelection',
      ownerId: 10,
      pokemonId: 25,
    })
    expect(s.duel?.phase).toBe('awaiting_actions')
    expect(s.duelPokemonState.find((p) => p.ownerId === 10)?.isActive).toBe(true)
  })
})

describe('reduceMockState — duelActionRejected', () => {
  it('records the rejection without advancing the turn or changing the phase', () => {
    const s = reduceMockState(makeDuelStateFixture(), {
      type: 'duelActionRejected',
      moveIndex: 1,
      reason: 'insufficient_pp',
    })
    expect(s.duel?.lastRejection).toEqual({ moveIndex: 1, reason: 'insufficient_pp' })
    expect(s.duel?.turnNumber).toBe(1)
    expect(s.duel?.phase).toBe('awaiting_actions')
  })

  it('is a no-op without an active duel', () => {
    const s = reduceMockState(createInitialState(), {
      type: 'duelActionRejected',
      moveIndex: 1,
      reason: 'insufficient_pp',
    })
    expect(s).toEqual(createInitialState())
  })
})

describe('reduceMockState — duelOpponentDisconnected', () => {
  it('flags the opponent as disconnected while keeping the duel interactive', () => {
    const s = reduceMockState(makeDuelStateFixture(), { type: 'duelOpponentDisconnected' })
    expect(s.duel?.opponentDisconnected).toBe(true)
    expect(s.duel?.phase).toBe('awaiting_actions')
  })

  it('is a no-op without an active duel', () => {
    const s = reduceMockState(createInitialState(), { type: 'duelOpponentDisconnected' })
    expect(s).toEqual(createInitialState())
  })
})

describe('reduceMockState — tournamentBracket', () => {
  it('merges slot pairings incrementally across broadcasts', () => {
    let s = reduceMockState(createInitialState(), {
      type: 'tournamentBracket',
      bracket: { semiA: { duelId: '1', playerA: '10', playerB: '11' } },
    })
    s = reduceMockState(s, {
      type: 'tournamentBracket',
      bracket: { final: { duelId: '9', playerA: '10', playerB: '11' } },
    })
    expect(s.tournament?.bracket.semiA).toEqual({ duelId: '1', playerA: '10', playerB: '11' })
    expect(s.tournament?.bracket.final).toEqual({ duelId: '9', playerA: '10', playerB: '11' })
  })

  it('leaves an empty bracket when the broadcast carries no pairings', () => {
    const s = reduceMockState(createInitialState(), {
      type: 'tournamentBracket',
      bracket: {},
    })
    expect(s.tournament?.bracket).toEqual({})
  })
})

describe('reduceMockState — roomFinalRanking', () => {
  it('stores the authoritative ranking', () => {
    const s = reduceMockState(createInitialState(), {
      type: 'roomFinalRanking',
      ranking: [
        { rank: 1, name: 'Ash', champion: true },
        { rank: 2, name: 'Misty', champion: false },
      ],
    })
    expect(s.finalRanking).toEqual([
      { rank: 1, name: 'Ash', champion: true },
      { rank: 2, name: 'Misty', champion: false },
    ])
  })
})

describe('reduceMockState — roomAborted / roomAbortedAcknowledged', () => {
  it('records a room:aborted reason so the UI can show a recovery banner', () => {
    const base = makeDuelStateFixture()
    const s = reduceMockState(base, {
      type: 'roomAborted',
      reason: 'server_restart',
    })
    expect(s.roomAborted).toEqual({ reason: 'server_restart' })
  })

  it('overwrites a previous reason when a new abort arrives', () => {
    let s = reduceMockState(makeDuelStateFixture(), {
      type: 'roomAborted',
      reason: 'first',
    })
    s = reduceMockState(s, { type: 'roomAborted', reason: 'second' })
    expect(s.roomAborted).toEqual({ reason: 'second' })
  })

  it('clears the aborted marker once the player acknowledges it', () => {
    let s = reduceMockState(makeDuelStateFixture(), {
      type: 'roomAborted',
      reason: 'server_restart',
    })
    expect(s.roomAborted).not.toBeNull()
    const after = reduceMockState(s, { type: 'roomAbortedAcknowledged' })
    expect(after.roomAborted).toBeNull()
  })

  it('starts with no aborted marker', () => {
    expect(createInitialState().roomAborted).toBeNull()
  })
})

describe('reduceMockState — roomJoinRejected', () => {
  it('clears the room-scoped slice (room/tournament/duel/pendingDuelId) while leaving player untouched', () => {
    let s = makeDuelStateFixture()
    s = reduceMockState(s, {
      type: 'tournamentBracket',
      bracket: { semiA: { duelId: '42', playerA: '10', playerB: '11' } },
    })
    s = reduceMockState(s, { type: 'pendingDuelSet', duelId: '42' })
    s = reduceMockState(s, {
      type: 'roomFinalRanking',
      ranking: [{ rank: 1, name: 'Ash', champion: true }],
    })

    const after = reduceMockState(s, { type: 'roomJoinRejected' })

    expect(after.player).toEqual(s.player)
    expect(after.room).toBeNull()
    expect(after.tournament).toBeNull()
    expect(after.duel).toBeNull()
    expect(after.pendingDuelId).toBeNull()
  })
})

describe('deriveDuelSlot', () => {
  it('returns 1v1 without a tournament', () => {
    expect(deriveDuelSlot('42', null)).toBe('1v1')
  })

  it('finds the bracket slot owning the duel id', () => {
    const tournament: TournamentState = {
      bracket: {
        semiA: { duelId: '1', playerA: '10', playerB: '11' },
        semiB: { duelId: '2', playerA: '12', playerB: '13' },
      },
    }
    expect(deriveDuelSlot('1', tournament)).toBe('semiA')
    expect(deriveDuelSlot('2', tournament)).toBe('semiB')
  })

  it('falls back to 1v1 for an unknown duel id', () => {
    const tournament: TournamentState = {
      bracket: { semiA: { duelId: '1', playerA: '10', playerB: '11' } },
    }
    expect(deriveDuelSlot('999', tournament)).toBe('1v1')
  })
})

describe('deriveDuelPhase', () => {
  function pokemon(ownerId: number, pokemonId: number, isActive: boolean, fainted = false) {
    return { duelId: '42', ownerId, pokemonId, name: 'X', type: 'normal', spriteUrl: 'f', backSpriteUrl: 'b', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive, fainted }
  }

  it('is finished when a winner is set', () => {
    const states = [pokemon(10, 25, false), pokemon(11, 5, true)]
    expect(deriveDuelPhase('11', states)).toBe('finished')
  })

  it('is lead_selection while no side has an active pokemon', () => {
    const states = [pokemon(10, 25, false), pokemon(11, 5, false)]
    expect(deriveDuelPhase(null, states)).toBe('lead_selection')
  })

  it('is awaiting_actions when both sides field an active pokemon', () => {
    const states = [pokemon(10, 25, true), pokemon(11, 5, true)]
    expect(deriveDuelPhase(null, states)).toBe('awaiting_actions')
  })

  it('is awaiting_switch when one side has no active pokemon but keeps bench', () => {
    const states = [
      pokemon(10, 25, true),
      pokemon(11, 5, false),
      pokemon(11, 6, false, true),
      pokemon(11, 7, false),
    ]
    expect(deriveDuelPhase(null, states)).toBe('awaiting_switch')
  })
})

describe('toDuelPokemonState', () => {
  it('fills name, type and both sprite urls from the catalog', () => {
    setCachedCatalog(duelCatalog)
    const raw = { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 80, ppMove1: 3, ppMove2: 4, ppMove3: 2, isActive: true, fainted: false }
    const p = toDuelPokemonState(raw, duelCatalog)
    expect(p.duelId).toBe('42')
    expect(p.ownerId).toBe(10)
    expect(p.pokemonId).toBe(25)
    expect(p.name).toBe('Pikachu')
    expect(p.spriteUrl).toBe('front-pikachu')
    expect(p.backSpriteUrl).toBe('back-pikachu')
    expect(p.currentHp).toBe(80)
    expect(p.ppMove1).toBe(3)
  })

  it('falls back to stub fields for unknown pokemon ids', () => {
    const raw = { duelId: 42, ownerId: 10, pokemonId: 999, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false }
    const p = toDuelPokemonState(raw, [])
    expect(p.name).toBe('999')
    expect(p.spriteUrl).toBe('')
    expect(p.backSpriteUrl).toBe('')
  })
})

describe('duelFromSnapshot', () => {
  it('maps a camelCase snapshot into DuelState and DuelPokemonState', () => {
    setCachedCatalog(duelCatalog)
    const snapshot: DuelSnapshot = {
      duelId: 42,
      turnNumber: 3,
      winnerId: null,
      endReason: null,
      pokemonStates: [
        { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 60, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
        { duelId: 42, ownerId: 11, pokemonId: 5, type: 'normal', currentHp: 60, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
      ],
    }
    const { duel, duelPokemonState } = duelFromSnapshot(snapshot, duelCatalog)
    const expectedDuel: DuelState = {
      duelId: '42',
      slot: '1v1',
      phase: 'awaiting_actions',
      turnNumber: 3,
      winnerId: null,
      endReason: null,
      opponentDisconnected: false,
      lastRejection: null,
    }
    expect(duel).toEqual(expectedDuel)
    expect(duelPokemonState[0]).toMatchObject({ ownerId: 10, pokemonId: 25, name: 'Pikachu' })
    expect(duelPokemonState[1]).toMatchObject({ ownerId: 11, pokemonId: 5, name: 'Snorlax' })
  })

  it('derives finished phase and stringified winner id from a finished snapshot', () => {
    const snapshot: DuelSnapshot = {
      duelId: 7,
      turnNumber: 5,
      winnerId: 11,
      endReason: 'ko',
      pokemonStates: [
        { duelId: 7, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 0, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: true },
        { duelId: 7, ownerId: 11, pokemonId: 5, type: 'normal', currentHp: 40, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
      ],
    }
    const { duel } = duelFromSnapshot(snapshot, [])
    expect(duel.phase).toBe('finished')
    expect(duel.winnerId).toBe('11')
    expect(duel.endReason).toBe('ko')
    expect(duel.slot).toBe('1v1')
  })
})

describe('reduceMockState — duel snapshots resolve the bracket slot', () => {
  it('derives the tournament slot from the bracket when duel:state resolves', () => {
    let s = reduceMockState(createInitialState(), {
      type: 'tournamentBracket',
      bracket: { semiA: { duelId: '42', playerA: '10', playerB: '11' } },
    })
    s = reduceMockState(s, {
      type: 'duelStateReceived',
      duel: {
        duelId: '42',
        slot: '1v1',
        phase: 'lead_selection',
        turnNumber: 1,
        winnerId: null,
        endReason: null,
        opponentDisconnected: false,
        lastRejection: null,
      },
      duelPokemonState: [],
    })
    expect(s.duel?.slot).toBe('semiA')
  })

  it('keeps the 1v1 slot when no bracket owns the duel', () => {
    const s = reduceMockState(createInitialState(), {
      type: 'duelStateReceived',
      duel: {
        duelId: '42',
        slot: '1v1',
        phase: 'awaiting_actions',
        turnNumber: 1,
        winnerId: null,
        endReason: null,
        opponentDisconnected: false,
        lastRejection: null,
      },
      duelPokemonState: [],
    })
    expect(s.duel?.slot).toBe('1v1')
  })
})

describe('reduceMockState — resetSession', () => {
  it('clears the room, tournament, team, duel, pending duel and ranking but keeps the nickname', () => {
    let s = makeDuelStateFixture()
    s = reduceMockState(s, {
      type: 'tournamentBracket',
      bracket: { semiA: { duelId: '42', playerA: '10', playerB: '11' } },
    })
    s = reduceMockState(s, { type: 'pendingDuelSet', duelId: '42' })
    s = reduceMockState(s, {
      type: 'roomFinalRanking',
      ranking: [{ rank: 1, name: 'Ash', champion: true }],
    })

    const after = reduceMockState(s, { type: 'resetSession' })

    expect(after.player.nickname).toBe('Ash')
    expect(after.room).toBeNull()
    expect(after.tournament).toBeNull()
    expect(after.teamSelection).toEqual({ starterId: null, rosterIds: [] })
    expect(after.duel).toBeNull()
    expect(after.duelPokemonState).toHaveLength(0)
    expect(after.pendingDuelId).toBeNull()
    expect(after.finalRanking).toBeNull()
  })
})
// @vitest-environment jsdom
// #10 PR 1 integration tests: every duel/tournament WS listener registers in
// the provider's central socket effect, real backend payloads (camelCase
// snapshots, numeric ids) land in state through the pure mapping helpers, and
// the new emitting actions fire the exact socket events the backend expects.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockStateProvider } from '../MockStateProvider'
import { useMockState } from '../useMockState'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { setCachedCatalog } from '../../lib/catalog'
import type { Pokemon } from '../../lib/catalog'
import type { MockState } from '../schema'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { disconnectSocket } from '../../lib/socket'

const wsCatalog: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'front-pikachu', back_sprite_url: 'back-pikachu', is_starter: true },
  { id: 5, name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'front-snorlax', back_sprite_url: 'back-snorlax', is_starter: false },
]

function makeFakeSocket(): Socket & { _fire: (event: string, payload?: unknown) => void } {
  const handlers = new Map<string, (payload?: unknown) => void>()
  const fakeSocketRef: Socket & { _fire: (event: string, payload?: unknown) => void } = {
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler)
      return fakeSocketRef
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event)
      return fakeSocketRef
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    // test helper: fire a server event through the registered handlers
    _fire: (event: string, payload?: unknown) => {
      handlers.get(event)?.(payload)
    },
  } as unknown as Socket & { _fire: (event: string, payload?: unknown) => void }
  return fakeSocketRef
}

let fakeSocket: ReturnType<typeof makeFakeSocket>

function bracketSummary(t: MockState['tournament']): string {
  if (!t) return 'no-bracket'
  return Object.entries(t.bracket)
    .map(([slot, p]) => (p ? `${slot}:${p.duelId}` : `${slot}:null`))
    .sort()
    .join('|')
}

function rankingSummary(r: MockState['finalRanking']): string {
  if (!r) return 'no-ranking'
  return r.map((e) => `${e.rank}:${e.name}:${e.champion ? 'champ' : 'cont'}`).join('|')
}

function DuelProbe() {
  const [state, actions] = useMockState()
  return (
    <div>
      <span data-testid="pending">{state.pendingDuelId ?? 'none'}</span>
      <span data-testid="duel-id">{state.duel?.duelId ?? 'no-duel'}</span>
      <span data-testid="duel-phase">{state.duel?.phase ?? 'no-duel'}</span>
      <span data-testid="duel-turn">{state.duel?.turnNumber ?? 'none'}</span>
      <span data-testid="duel-slot">{state.duel?.slot ?? 'none'}</span>
      <span data-testid="duel-winner">{state.duel?.winnerId ?? 'none'}</span>
      <span data-testid="active-name">
        {state.duelPokemonState.find((p) => p.isActive)?.name ?? 'none'}
      </span>
      <span data-testid="hp-first">{state.duelPokemonState[0]?.currentHp ?? 'none'}</span>
      <span data-testid="disconnected">{state.duel?.opponentDisconnected ? 'yes' : 'no'}</span>
      <span data-testid="rejection">{state.duel?.lastRejection?.reason ?? 'none'}</span>
      <span data-testid="bracket">{bracketSummary(state.tournament)}</span>
      <span data-testid="ranking">{rankingSummary(state.finalRanking)}</span>
      <span data-testid="aborted">{state.roomAborted?.reason ?? 'none'}</span>
      <button
        type="button"
        onClick={() =>
          actions.sessionEstablished({
            playerId: '10',
            sessionToken: 'token-1',
            nickname: 'Ash',
          })
        }
      >
        establish
      </button>
      <button type="button" onClick={() => actions.selectLead(25)}>
        selectLead
      </button>
      <button type="button" onClick={() => actions.submitAction(0)}>
        submitAction
      </button>
      <button type="button" onClick={() => actions.submitSwitch(23)}>
        submitSwitch
      </button>
      <button type="button" onClick={() => actions.confirmSwap(23)}>
        confirmSwap
      </button>
      <button type="button" onClick={() => actions.surrenderDuel()}>
        surrenderDuel
      </button>
      <button type="button" onClick={() => actions.joinDuel('42')}>
        joinDuel
      </button>
    </div>
  )
}

function renderProvider() {
  return render(
    <MockStateProvider>
      <MemoryRouter>
        <DuelProbe />
      </MemoryRouter>
    </MockStateProvider>,
  )
}

const leadSelectionSnapshot = {
  duelId: 42,
  turnNumber: 1,
  winnerId: null,
  endReason: null,
  pokemonStates: [
    { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
    { duelId: 42, ownerId: 11, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
  ],
}

beforeEach(() => {
  fakeSocket = makeFakeSocket()
  vi.mocked(io).mockReturnValue(fakeSocket as never)
  setCachedCatalog(wsCatalog)
})

afterEach(() => {
  vi.clearAllMocks()
  setCachedCatalog(null)
  disconnectSocket()
})

describe('MockStateProvider — duel/tournament WS listener registration', () => {
  it('subscribes every duel/tournament event in the central socket effect', () => {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })
    for (const event of [
      'duel:start',
      'duel:state',
      'duel:turn_resolved',
      'duel:finished',
      'duel:action_rejected',
      'duel:opponent_disconnected',
      'tournament:bracket',
      'room:final_ranking',
    ]) {
      expect(fakeSocket.on).toHaveBeenCalledWith(event, expect.any(Function))
    }
  })

  it('records a pending duel from duel:start and clears it once duel:state resolves', () => {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })
    expect(screen.getByTestId('pending').textContent).toBe('none')

    act(() => {
      fakeSocket._fire('duel:start', { duelId: 42 })
    })
    expect(screen.getByTestId('pending').textContent).toBe('42')

    act(() => {
      fakeSocket._fire('tournament:bracket', {
        roomId: 1,
        bracket: { semiA: { duelId: 42, playerA: 10, playerB: 11 } },
      })
      fakeSocket._fire('duel:state', leadSelectionSnapshot)
    })
    expect(screen.getByTestId('pending').textContent).toBe('none')
    expect(screen.getByTestId('duel-id').textContent).toBe('42')
  })
})

describe('MockStateProvider — tournament bracket and final ranking consumption', () => {
  it('merges tournament:bracket broadcasts into the bracket projection', () => {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })
    expect(screen.getByTestId('bracket').textContent).toBe('no-bracket')

    act(() => {
      fakeSocket._fire('tournament:bracket', {
        roomId: 1,
        bracket: { semiA: { duelId: 42, playerA: 10, playerB: 11 } },
      })
    })
    expect(screen.getByTestId('bracket').textContent).toContain('semiA:42')

    act(() => {
      fakeSocket._fire('tournament:bracket', {
        roomId: 1,
        bracket: { final: { duelId: 9, playerA: 10, playerB: 11 } },
      })
    })
    expect(screen.getByTestId('bracket').textContent).toContain('final:9')
    expect(screen.getByTestId('bracket').textContent).toContain('semiA:42')
  })

  it('maps room:final_ranking into champion-first RankingEntry rows', () => {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })
    expect(screen.getByTestId('ranking').textContent).toBe('no-ranking')

    act(() => {
      fakeSocket._fire('room:final_ranking', {
        roomId: 1,
        ranking: [
          { playerId: 10, nickname: 'Ash', finalRank: 1 },
          { playerId: 11, nickname: 'Misty', finalRank: 2 },
        ],
      })
    })
    expect(screen.getByTestId('ranking').textContent).toBe('1:Ash:champ|2:Misty:cont')
  })
})

describe('MockStateProvider — room:aborted recovery signal', () => {
  it('dispatches the roomAborted action when room:aborted is emitted', () => {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })
    expect(screen.getByTestId('aborted').textContent).toBe('none')

    act(() => {
      fakeSocket._fire('room:aborted', { reason: 'server_restart' })
    })
    expect(screen.getByTestId('aborted').textContent).toBe('server_restart')
  })

  it('subscribes and unsubscribes room:aborted in the central socket effect', () => {
    const { unmount } = renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })
    expect(fakeSocket.on).toHaveBeenCalledWith('room:aborted', expect.any(Function))
    act(() => {
      unmount()
    })
    expect(fakeSocket.off).toHaveBeenCalledWith('room:aborted')
  })
})

describe('MockStateProvider — duel:state snapshot mapping', () => {
  it('derives phase/slot, enriches pokemon from the catalog and keeps the room intact', () => {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })
    act(() => {
      fakeSocket._fire('tournament:bracket', {
        roomId: 1,
        bracket: { semiA: { duelId: 42, playerA: 10, playerB: 11 } },
      })
      fakeSocket._fire('duel:state', leadSelectionSnapshot)
    })

    // No side fields a pokemon yet -> lead_selection; bracket owns duel 42 -> semiA.
    expect(screen.getByTestId('duel-phase').textContent).toBe('lead_selection')
    expect(screen.getByTestId('duel-slot').textContent).toBe('semiA')
    expect(screen.getByTestId('duel-turn').textContent).toBe('1')
    expect(screen.getByTestId('active-name').textContent).toBe('none')
    expect(screen.getByTestId('hp-first').textContent).toBe('100')
  })
})

describe('MockStateProvider — emitting actions', () => {
  function establishWithDuel() {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })
    act(() => {
      fakeSocket._fire('duel:start', { duelId: 42 })
      fakeSocket._fire('duel:state', leadSelectionSnapshot)
    })
  }

  it('selectLead emits duel:select_lead and optimistically activates the lead', () => {
    establishWithDuel()
    act(() => {
      screen.getByRole('button', { name: 'selectLead' }).click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:select_lead', {
      duelId: 42,
      pokemonId: 25,
    })
    expect(screen.getByTestId('duel-phase').textContent).toBe('awaiting_actions')
    expect(screen.getByTestId('active-name').textContent).toBe('Pikachu')
  })

  it('submitAction emits duel:select_action with the 1-based move index', () => {
    establishWithDuel()
    act(() => {
      screen.getByRole('button', { name: 'submitAction' }).click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:select_action', {
      duelId: 42,
      moveIndex: 1,
    })
  })

  it('submitSwitch and legacy confirmSwap emit duel:switch_decision', () => {
    establishWithDuel()
    act(() => {
      screen.getByRole('button', { name: 'submitSwitch' }).click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:switch_decision', {
      duelId: 42,
      switchTo: 23,
    })
    act(() => {
      screen.getByRole('button', { name: 'confirmSwap' }).click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:switch_decision', {
      duelId: 42,
      switchTo: 23,
    })
  })

  it('surrenderDuel emits duel:surrender and joinDuel emits duel:join', () => {
    establishWithDuel()
    act(() => {
      screen.getByRole('button', { name: 'surrenderDuel' }).click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:surrender', { duelId: 42 })

    act(() => {
      screen.getByRole('button', { name: 'joinDuel' }).click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:join', { duelId: 42 })
  })
})

describe('MockStateProvider — server-pushed duel progression', () => {
  function establishWithLiveDuel() {
    renderProvider()
    act(() => {
      screen.getByRole('button', { name: 'establish' }).click()
    })
    act(() => {
      fakeSocket._fire('duel:start', { duelId: 42 })
      fakeSocket._fire('duel:state', leadSelectionSnapshot)
      fakeSocket._fire('duel:turn_resolved', {
        duelId: 42,
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        pokemonStates: [
          { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 75, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
          { duelId: 42, ownerId: 11, pokemonId: 5, type: 'normal', currentHp: 75, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
        ],
      })
    })
  }

  it('renders server-resolved HP and turn from duel:turn_resolved', () => {
    establishWithLiveDuel()
    expect(screen.getByTestId('duel-turn').textContent).toBe('2')
    expect(screen.getByTestId('hp-first').textContent).toBe('75')
    expect(screen.getByTestId('duel-phase').textContent).toBe('awaiting_actions')
  })

  it('shows the opponent-disconnect banner until the next resolution clears it', () => {
    establishWithLiveDuel()
    act(() => {
      fakeSocket._fire('duel:opponent_disconnected', { duelId: 42 })
    })
    expect(screen.getByTestId('disconnected').textContent).toBe('yes')

    act(() => {
      fakeSocket._fire('duel:turn_resolved', {
        duelId: 42,
        turnNumber: 3,
        winnerId: null,
        endReason: null,
        pokemonStates: [
          { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 50, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
          { duelId: 42, ownerId: 11, pokemonId: 5, type: 'normal', currentHp: 50, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
        ],
      })
    })
    expect(screen.getByTestId('disconnected').textContent).toBe('no')
    expect(screen.getByTestId('duel-turn').textContent).toBe('3')
  })

  it('surfaces duel:action_rejected without advancing the turn', () => {
    establishWithLiveDuel()
    act(() => {
      fakeSocket._fire('duel:action_rejected', { moveIndex: 2, reason: 'insufficient_pp' })
    })
    expect(screen.getByTestId('rejection').textContent).toBe('insufficient_pp')
    expect(screen.getByTestId('duel-turn').textContent).toBe('2')
  })

  it('marks the duel finished from duel:finished and clears the disconnect banner', () => {
    establishWithLiveDuel()
    act(() => {
      fakeSocket._fire('duel:opponent_disconnected', { duelId: 42 })
    })
    act(() => {
      fakeSocket._fire('duel:finished', { duelId: 42, winnerId: 11, endReason: 'ko' })
    })
    expect(screen.getByTestId('duel-phase').textContent).toBe('finished')
    expect(screen.getByTestId('duel-winner').textContent).toBe('11')
    expect(screen.getByTestId('disconnected').textContent).toBe('no')
  })
})
// @vitest-environment jsdom
// #10 PR 2 rewrite: the mock engine is gone, so DuelBoardScreen's presentation
// behaviors are exercised against server-shaped pre-seeded state — HUD, the
// surrender dialog (confirming emits duel:surrender via WS), voluntary/forced
// swap navigation, and Rules-of-Hooks safety when a duel lands via WS.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import { STORAGE_KEY, serializeMockState } from '../../state/store'
import { setCachedCatalog } from '../../lib/catalog'
import type { Pokemon } from '../../lib/catalog'
import type { DuelPokemonState, DuelState, MockState } from '../../state/schema'
import DuelBoardScreen from '../DuelBoardScreen'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { disconnectSocket } from '../../lib/socket'

const duelSeedFixture: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'front-pikachu', back_sprite_url: 'back-pikachu', is_starter: true },
  { id: 5, name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'front-snorlax', back_sprite_url: 'back-snorlax', is_starter: false },
]

function makeFakeSocket(): Socket & { _fire: (event: string, payload?: unknown) => void } {
  const handlers = new Map<string, (payload?: unknown) => void>()
  const fake = {
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler)
      return fake
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event)
      return fake
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    _fire: (event: string, payload?: unknown) => {
      handlers.get(event)?.(payload)
    },
  }
  return fake as unknown as Socket & { _fire: (event: string, payload?: unknown) => void }
}

let fakeSocket: ReturnType<typeof makeFakeSocket>

function makePokemon(
  ownerId: number,
  pokemonId: number,
  name: string,
  isActive: boolean,
  overrides: Partial<DuelPokemonState> = {},
): DuelPokemonState {
  return {
    duelId: '42',
    ownerId,
    pokemonId,
    name,
    type: 'normal',
    spriteUrl: `front-${name.toLowerCase()}`,
    backSpriteUrl: `back-${name.toLowerCase()}`,
    currentHp: isActive ? 100 : 0,
    ppMove1: 4,
    ppMove2: 4,
    ppMove3: 4,
    isActive,
    fainted: !isActive,
    ...overrides,
  }
}

function makeDuel(phase: DuelState['phase']): DuelState {
  return {
    duelId: '42',
    slot: '1v1',
    phase,
    turnNumber: 1,
    winnerId: null,
    endReason: null,
    opponentDisconnected: false,
    lastRejection: null,
  }
}

function buildLiveState(overrides: Partial<MockState> = {}): MockState {
  return {
    player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
    room: {
      code: 'AB12',
      maxPlayers: 2,
      status: 'in_progress',
      players: [{ playerId: '10', nickname: 'Ash', ready: false, connected: true }],
    },
    teamSelection: { starterId: 25, rosterIds: [] },
    tournament: null,
    duelPokemonState: [
      makePokemon(10, 25, 'Pikachu', true),
      makePokemon(11, 5, 'Snorlax', true),
    ],
    duel: makeDuel('awaiting_actions'),
    pendingDuelId: null,
    finalRanking: null,
    ...overrides,
  }
}

function DuelPhaseProbe() {
  const [state] = useMockState()
  return (
    <span data-testid="duel-probe">
      phase:{state.duel?.phase ?? 'none'}|winner:{state.duel?.winnerId ?? 'none'}
      |turn:{state.duel?.turnNumber ?? 'none'}
    </span>
  )
}

function SwapModeProbe() {
  const [state] = useMockState()
  const [params] = useSearchParams()
  return (
    <span data-testid="swap-probe">
      mode:{params.get('mode') ?? 'none'}
      |active:{state.duelPokemonState.find((p) => p.ownerId === Number(state.player.playerId) && p.isActive)?.pokemonId ?? 'none'}
    </span>
  )
}

function WaitForDuel({ children }: { children: ReactNode }) {
  const [state] = useMockState()
  if (!state.duel) return <div>setting-up-duel</div>
  return <>{children}</>
}

function renderBoardFromState(state: MockState) {
  localStorage.setItem(STORAGE_KEY, serializeMockState(state))
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/duel']}>
        <DuelPhaseProbe />
        <Routes>
          <Route
            path="/duel"
            element={
              <WaitForDuel>
                <DuelBoardScreen />
              </WaitForDuel>
            }
          />
          <Route
            path="/swap"
            element={
              <>
                <SwapModeProbe />
                <div>SWAP-LANDED</div>
              </>
            }
          />
          <Route path="/wait-room" element={<div>WAIT-ROOM-LANDED</div>} />
          <Route path="/ranking" element={<div>RANKING-LANDED</div>} />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

beforeEach(() => {
  fakeSocket = makeFakeSocket()
  vi.mocked(io).mockReturnValue(fakeSocket as never)
  setCachedCatalog(duelSeedFixture)
})

afterEach(() => {
  vi.clearAllMocks()
  setCachedCatalog(null)
  disconnectSocket()
})

describe('DuelBoardScreen — HUD', () => {
  it('renders the player and rival HUDs with active pokemon names and full HP', () => {
    renderBoardFromState(buildLiveState())
    const humanHud = screen.getByTestId('hud-human')
    const rivalHud = screen.getByTestId('hud-rival')
    expect(within(humanHud).getByText('PIKACHU')).toBeInTheDocument()
    expect(within(rivalHud).getByText('SNORLAX')).toBeInTheDocument()
    expect(within(humanHud).getByText('100/100')).toBeInTheDocument()
    expect(within(rivalHud).getByText('100/100')).toBeInTheDocument()
  })

  it('renders the GB-style sprites: rival seen from the front, own pokemon from the back', () => {
    renderBoardFromState(buildLiveState())
    const humanHud = screen.getByTestId('hud-human')
    const rivalHud = screen.getByTestId('hud-rival')

    const rivalSprite = within(rivalHud).getByRole('img')
    expect(rivalSprite).toHaveAttribute('src', 'front-snorlax')
    expect(rivalSprite).toHaveAttribute('alt', 'Snorlax')

    const humanSprite = within(humanHud).getByRole('img')
    expect(humanSprite).toHaveAttribute('src', 'back-pikachu')
    expect(humanSprite).toHaveAttribute('alt', 'Pikachu')
  })

  it('shows the HP bars with the live HP value', () => {
    renderBoardFromState(buildLiveState())
    const bars = screen.getAllByRole('progressbar', { name: /hp/i })
    expect(bars).toHaveLength(2)
    for (const bar of bars) {
      expect(bar).toHaveAttribute('aria-valuenow', '100')
      expect(bar).toHaveAttribute('aria-valuemax', '100')
    }
  })
})

describe('DuelBoardScreen — move grid', () => {
  it('exposes all four moves with their damage labels', () => {
    renderBoardFromState(buildLiveState())
    expect(screen.getByRole('button', { name: /25% dmg/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /20% dmg/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /15% dmg/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /10% dmg/i })).toBeInTheDocument()
  })
})

describe('DuelBoardScreen — surrender', () => {
  it('opens a custom confirm dialog when the surrender button is clicked', () => {
    renderBoardFromState(buildLiveState())
    act(() => {
      screen.getByRole('button', { name: /rendirse/i }).click()
    })
    const dialog = screen.getByRole('dialog', { name: /rendirse/i })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /rendirse/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /seguir luchando/i })).toBeInTheDocument()
  })

  it('closes the dialog and keeps the duel running when the player cancels', () => {
    renderBoardFromState(buildLiveState())
    act(() => {
      screen.getByRole('button', { name: /rendirse/i }).click()
    })
    act(() => {
      screen.getByRole('button', { name: /seguir luchando/i }).click()
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('duel-probe').textContent).toContain('phase:awaiting_actions')
  })

  it('emits duel:surrender via WS and closes the dialog when the player confirms', () => {
    renderBoardFromState(buildLiveState())
    act(() => {
      screen.getByRole('button', { name: /rendirse/i }).click()
    })
    const dialog = screen.getByRole('dialog', { name: /rendirse/i })
    act(() => {
      within(dialog).getByRole('button', { name: /rendirse/i }).click()
    })

    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:surrender', { duelId: 42 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The server owns the finish — no local phase flip.
    expect(screen.getByTestId('duel-probe').textContent).toContain('phase:awaiting_actions')
  })
})

describe('DuelBoardScreen — swap navigation', () => {
  it('opens the swap screen in voluntary mode when the player clicks cambiar pokemon', () => {
    renderBoardFromState(buildLiveState())
    act(() => {
      screen.getByRole('button', { name: /cambiar pokémon/i }).click()
    })

    expect(screen.getByText('SWAP-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('swap-probe').textContent).toContain('mode:voluntary')
    // The duel is untouched: still awaiting actions with the human active out.
    expect(screen.getByTestId('duel-probe').textContent).toContain('phase:awaiting_actions')
  })

  it('navigates to the swap screen in forced mode when the server marks awaiting_switch', () => {
    renderBoardFromState(
      buildLiveState({
        duelPokemonState: [
          makePokemon(10, 25, 'Pikachu', false, { currentHp: 0, fainted: true }),
          makePokemon(10, 5, 'Snorlax', false),
          makePokemon(11, 6, 'Eevee', true),
        ],
        duel: makeDuel('awaiting_switch'),
      }),
    )

    expect(screen.getByText('SWAP-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('swap-probe').textContent).toContain('mode:forced')
  })
})

describe('DuelBoardScreen — Rules of Hooks safety', () => {
  it('does not crash when duel flips from null to set via WS while the screen stays mounted', () => {
    // Seed only room + session (no duel) so the FIRST render hits the `!duel`
    // branch. The screen is mounted directly (no Route/Navigate gate) so the
    // instance survives the null -> set transition in place — exactly the
    // scenario a Rules-of-Hooks violation crashes on.
    localStorage.setItem(STORAGE_KEY, serializeMockState(buildLiveState({ duel: null, duelPokemonState: [] })))

    render(
      <MockStateProvider>
        <MemoryRouter initialEntries={['/duel']}>
          <DuelBoardScreen />
        </MemoryRouter>
      </MockStateProvider>,
    )

    act(() => {
      fakeSocket._fire('duel:start', { duelId: 42 })
      fakeSocket._fire('duel:state', {
        duelId: 42,
        turnNumber: 1,
        winnerId: null,
        endReason: null,
        pokemonStates: [
          { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
          { duelId: 42, ownerId: 11, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
        ],
      })
    })

    expect(screen.getByTestId('hud-human')).toBeInTheDocument()
    expect(screen.getByTestId('hud-rival')).toBeInTheDocument()
  })
})
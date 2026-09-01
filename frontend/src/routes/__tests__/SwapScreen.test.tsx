// @vitest-environment jsdom
// #10 PR 2: SwapScreen submits the switch via WS (duel:switch_decision with
// the numeric server-issued pokemon id) and no longer mutates local duel state
// — the server owns the new active pokemon.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import { STORAGE_KEY, serializeMockState, type DuelSnapshot } from '../../state/store'
import { setCachedCatalog } from '../../lib/catalog'
import type { Pokemon } from '../../lib/catalog'
import type { DuelPokemonState, MockState } from '../../state/schema'
import SwapScreen from '../SwapScreen'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { disconnectSocket } from '../../lib/socket'

const swapCatalog: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
  { id: 5, name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 6, name: 'Eevee', type: 'normal', pokeapi_id: 133, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 23, name: 'Pidgeot', type: 'flying', pokeapi_id: 18, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
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

beforeEach(() => {
  fakeSocket = makeFakeSocket()
  vi.mocked(io).mockReturnValue(fakeSocket as never)
  setCachedCatalog(swapCatalog)
})

afterEach(() => {
  vi.clearAllMocks()
  setCachedCatalog(null)
  disconnectSocket()
})

function ActivePokemonProbe() {
  const [state] = useMockState()
  const active = state.duelPokemonState.find(
    (p) => p.ownerId === Number(state.player.playerId) && p.isActive,
  )
  return (
    <span data-testid="active-probe">
      active:{active?.pokemonId ?? 'none'}|phase:{state.duel?.phase ?? 'none'}
    </span>
  )
}

function makePokemon(
  ownerId: number,
  pokemonId: number,
  name: string,
  overrides: Partial<DuelPokemonState> = {},
): DuelPokemonState {
  return {
    duelId: '42',
    ownerId,
    pokemonId,
    name,
    type: 'normal',
    spriteUrl: '',
    backSpriteUrl: '',
    currentHp: 100,
    ppMove1: 4,
    ppMove2: 4,
    ppMove3: 4,
    isActive: false,
    fainted: false,
    ...overrides,
  }
}

function baseState(duel: MockState['duel'], duelPokemonState: DuelPokemonState[]): MockState {
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
    duelPokemonState,
    duel,
    pendingDuelId: null,
    finalRanking: null,
    roomAborted: null,
  }
}

// State mirroring a KO: the human active fainted, bench healthy, duel paused.
function buildForcedSwapState(): MockState {
  return baseState(
    {
      duelId: '42',
      slot: '1v1',
      phase: 'awaiting_switch',
      turnNumber: 2,
      winnerId: null,
      endReason: null,
      opponentDisconnected: false,
      lastRejection: null,
    },
    [
      makePokemon(10, 25, 'Pikachu', { currentHp: 0, isActive: false, fainted: true }),
      makePokemon(10, 5, 'Snorlax'),
      makePokemon(10, 6, 'Eevee'),
      makePokemon(11, 23, 'Pidgeot', { isActive: true }),
    ],
  )
}

function buildLiveVoluntaryState(): MockState {
  return baseState(
    {
      duelId: '42',
      slot: '1v1',
      phase: 'awaiting_actions',
      turnNumber: 1,
      winnerId: null,
      endReason: null,
      opponentDisconnected: false,
      lastRejection: null,
    },
    [
      makePokemon(10, 25, 'Pikachu', { isActive: true }),
      makePokemon(10, 5, 'Snorlax'),
      makePokemon(10, 6, 'Eevee'),
      makePokemon(11, 23, 'Pidgeot', { isActive: true }),
    ],
  )
}

// Covers the .unit-card--active / .flag--danger / .unit-card--ko trio in one
// bench: a live active, a low-HP bench unit and a fainted bench unit.
function buildDangerState(): MockState {
  return baseState(
    {
      duelId: '42',
      slot: '1v1',
      phase: 'awaiting_switch',
      turnNumber: 2,
      winnerId: null,
      endReason: null,
      opponentDisconnected: false,
      lastRejection: null,
    },
    [
      makePokemon(10, 25, 'Pikachu', { currentHp: 100, isActive: true }),
      makePokemon(10, 5, 'Snorlax', { currentHp: 10 }),
      makePokemon(10, 6, 'Eevee', { currentHp: 0, fainted: true }),
      makePokemon(11, 23, 'Pidgeot', { isActive: true }),
    ],
  )
}

// Server broadcast after a successful duel:switch_decision: Snorlax (5) is now
// the human's active, the previous lead is deactivated (fainted only in the
// forced case). The client navigates back only once this snapshot lands.
function switchSnapshot(pikachuFainted: boolean): DuelSnapshot {
  return {
    duelId: 42,
    turnNumber: 2,
    winnerId: null,
    endReason: null,
    pokemonStates: [
      { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: pikachuFainted ? 0 : 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: pikachuFainted },
      { duelId: 42, ownerId: 10, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
      { duelId: 42, ownerId: 10, pokemonId: 6, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
      { duelId: 42, ownerId: 11, pokemonId: 23, type: 'flying', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
    ],
  }
}

function renderSwapFromState(state: MockState, initialPath: string) {
  localStorage.setItem(STORAGE_KEY, serializeMockState(state))
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <ActivePokemonProbe />
        <Routes>
          <Route path="/swap" element={<SwapScreen />} />
          <Route path="/duel" element={<div>DUEL-LANDED</div>} />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

describe('SwapScreen — forced mode', () => {
  it('exposes exactly one main landmark with id="main-content" (UX7)', () => {
    renderSwapFromState(buildForcedSwapState(), '/swap?mode=forced')
    const mains = screen.getAllByRole('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]).toHaveAttribute('id', 'main-content')
  })

  it('does not offer a cancel control when opened after a KO', () => {
    renderSwapFromState(buildForcedSwapState(), '/swap?mode=forced')

    expect(screen.getByText(/selección obligatoria/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /volver al combate/i })).not.toBeInTheDocument()
  })

  it('marks the fainted pokemon as out of service and the bench as selectable', () => {
    renderSwapFromState(buildForcedSwapState(), '/swap?mode=forced')

    expect(screen.getByRole('button', { name: /pikachu/i })).toBeDisabled()
    expect(screen.getByText('UNIDAD FUERA DE SERVICIO')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /snorlax/i })).toBeEnabled()
  })

  it('re-requests the duel state and offers an escape when the forced roster is empty (QA-round-3)', () => {
    renderSwapFromState({ ...buildForcedSwapState(), duelPokemonState: [] }, '/swap?mode=forced')

    expect(screen.getByTestId('bench-empty')).toBeInTheDocument()
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:join', { duelId: 42 })
    // never trapped: a way back to the board exists even in forced mode.
    expect(screen.getByRole('button', { name: /volver al combate/i })).toBeInTheDocument()
  })

  it('emits duel:switch_decision with the numeric id and returns to the duel without local mutation', async () => {
    renderSwapFromState(buildForcedSwapState(), '/swap?mode=forced')

    act(() => {
      screen.getByRole('button', { name: /snorlax/i }).click()
    })
    act(() => {
      screen.getByRole('button', { name: /confirmar cambio/i }).click()
    })

    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:switch_decision', {
      duelId: 42,
      switchTo: 5,
    })
    // Navigation waits for the server's duel:state broadcast (emitted after a
    // successful applySwitchDecision) — no emit-and-navigate race.
    act(() => {
      fakeSocket._fire('duel:state', switchSnapshot(true))
    })
    expect(screen.getByText('DUEL-LANDED')).toBeInTheDocument()
    // The server owns the new active pokemon — the client does not flip it.
    expect(screen.getByTestId('active-probe').textContent).toContain('active:5')
  })
})

describe('SwapScreen — voluntary mode', () => {
  it('keeps the current active pokemon and returns to the duel when canceled', async () => {
    renderSwapFromState(buildLiveVoluntaryState(), '/swap?mode=voluntary')

    act(() => {
      screen.getByRole('button', { name: /volver al combate/i }).click()
    })

    expect(screen.getByText('DUEL-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('active-probe').textContent).toContain('active:25')
  })

  it('labels the active pokemon as currently deployed and disables it', () => {
    renderSwapFromState(buildLiveVoluntaryState(), '/swap?mode=voluntary')

    expect(screen.getByText('DESPLEGADO ACTUALMENTE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pikachu/i })).toBeDisabled()
  })

  it('requires a selection before the confirm button enables', () => {
    renderSwapFromState(buildLiveVoluntaryState(), '/swap?mode=voluntary')
    expect(screen.getByRole('button', { name: /confirmar cambio/i })).toBeDisabled()
  })

  it('emits duel:switch_decision for the selected bench pokemon and returns to the duel board', async () => {
    renderSwapFromState(buildLiveVoluntaryState(), '/swap?mode=voluntary')

    act(() => {
      screen.getByRole('button', { name: /snorlax/i }).click()
    })
    act(() => {
      screen.getByRole('button', { name: /confirmar cambio/i }).click()
    })

    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:switch_decision', {
      duelId: 42,
      switchTo: 5,
    })
    // Navigation waits for the server's duel:state broadcast confirming the switch.
    act(() => {
      fakeSocket._fire('duel:state', switchSnapshot(false))
    })
    expect(screen.getByText('DUEL-LANDED')).toBeInTheDocument()
  })

  it('stays on the swap screen and surfaces the reason when the switch is rejected', async () => {
    renderSwapFromState(buildLiveVoluntaryState(), '/swap?mode=voluntary')

    act(() => {
      screen.getByRole('button', { name: /snorlax/i }).click()
    })
    act(() => {
      screen.getByRole('button', { name: /confirmar cambio/i }).click()
    })

    act(() => {
      fakeSocket._fire('duel:switch_rejected', { switchTo: 5, reason: 'fainted' })
    })

    expect(screen.queryByText('DUEL-LANDED')).not.toBeInTheDocument()
    expect(screen.getByText(/CAMBIO RECHAZADO/i)).toBeInTheDocument()
    expect(screen.getByText(/fainted/i)).toBeInTheDocument()
  })

  it('does not let a stale rejection block a second, different switch attempt', async () => {
    renderSwapFromState(buildLiveVoluntaryState(), '/swap?mode=voluntary')

    // First attempt (Snorlax) is rejected.
    act(() => {
      screen.getByRole('button', { name: /snorlax/i }).click()
    })
    act(() => {
      screen.getByRole('button', { name: /confirmar cambio/i }).click()
    })
    act(() => {
      fakeSocket._fire('duel:switch_rejected', { switchTo: 5, reason: 'fainted' })
    })
    expect(screen.getByText(/CAMBIO RECHAZADO/i)).toBeInTheDocument()

    // Second attempt (Eevee) must not be instantly failed by the leftover
    // lastRejection object from the first attempt — it should wait for this
    // attempt's own server response.
    act(() => {
      screen.getByRole('button', { name: /eevee/i }).click()
    })
    act(() => {
      screen.getByRole('button', { name: /confirmar cambio/i }).click()
    })
    act(() => {
      fakeSocket._fire('duel:state', {
        duelId: 42,
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        pokemonStates: [
          { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
          { duelId: 42, ownerId: 10, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
          { duelId: 42, ownerId: 10, pokemonId: 6, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
          { duelId: 42, ownerId: 11, pokemonId: 23, type: 'flying', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
        ],
      } satisfies DuelSnapshot)
    })

    expect(screen.getByText('DUEL-LANDED')).toBeInTheDocument()
  })
})

describe('SwapScreen — bench card state classes (Fase 7 PR10)', () => {
  it('classes the cards: active glow, danger flag on low HP, KO overlay on fainted', () => {
    const { container } = renderSwapFromState(buildDangerState(), '/swap?mode=voluntary')

    expect(container.querySelector('.unit-card--active')).not.toBeNull()
    expect(screen.getByText('EN CAMPO')).toBeInTheDocument()
    expect(container.querySelector('.flag--danger')).not.toBeNull()
    expect(screen.getByText('EN PELIGRO')).toBeInTheDocument()
    expect(container.querySelector('.unit-card--ko')).not.toBeNull()
    expect(container.querySelector('.ko-flag')).not.toBeNull()
    expect(screen.getByText('K.O.')).toBeInTheDocument()
  })

  it('keeps the cancel control in the topbar action slot in voluntary mode', () => {
    const { container } = renderSwapFromState(buildLiveVoluntaryState(), '/swap?mode=voluntary')

    const actionSlot = container.querySelector('.pd-topbar__end')
    expect(actionSlot).not.toBeNull()
    expect(
      within(actionSlot as HTMLElement).getByRole('button', { name: /volver al combate/i }),
    ).toBeInTheDocument()
  })
})
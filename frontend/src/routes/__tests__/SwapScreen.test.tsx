// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import type { MockStateActions } from '../../state/useMockState'
import { STORAGE_KEY, serializeMockState } from '../../state/store'
import { setCachedCatalog } from '../../lib/catalog'
import type { Pokemon } from '../../lib/catalog'
import type { DuelPokemonState, MockState } from '../../state/schema'
import SwapScreen from '../SwapScreen'

// Catalog resolved by enterDuel when seedLiveDuel starts the duel: Pikachu
// (25) is the starter and Snorlax (5) leads the bench shown in the tests.
const swapCatalog: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
  { id: 5, name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 6, name: 'Eevee', type: 'normal', pokeapi_id: 133, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 23, name: 'Pidgeot', type: 'flying', pokeapi_id: 18, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 14, name: 'Sceptile', type: 'grass', pokeapi_id: 254, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 17, name: 'Machamp', type: 'fighting', pokeapi_id: 68, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 33, name: 'Onix', type: 'rock', pokeapi_id: 95, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 15, name: 'Gengar', type: 'ghost', pokeapi_id: 94, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
]

beforeEach(() => {
  setCachedCatalog(swapCatalog)
})

function SeedProbe({ seed }: { seed?: (actions: MockStateActions) => void }) {
  const [, actions] = useMockState()
  const seeded = useRef(false)
  if (!seeded.current && seed) {
    seeded.current = true
    seed(actions)
  }
  return null
}

function ActivePokemonProbe() {
  const [state] = useMockState()
  const active = state.duelPokemonState.find(
    (p) => p.ownerId === state.player.nickname && p.isActive,
  )
  return (
    <span data-testid="active-probe">
      active:{active?.pokemonId ?? 'none'}|phase:{state.duel?.phase ?? 'none'}
    </span>
  )
}

function WaitForDuel({ children }: { children: ReactNode }) {
  const [state] = useMockState()
  if (!state.duel) return <div>setting-up-duel</div>
  return <>{children}</>
}

function swapRoutes() {
  return (
    <Routes>
      <Route
        path="/swap"
        element={
          <WaitForDuel>
            <SwapScreen />
          </WaitForDuel>
        }
      />
      <Route
        path="/duel"
        element={
          <>
            <div>DUEL-LANDED</div>
          </>
        }
      />
    </Routes>
  )
}

function renderSwap(initialPath: string, seed?: (actions: MockStateActions) => void) {
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <SeedProbe seed={seed} />
        <ActivePokemonProbe />
        {swapRoutes()}
      </MemoryRouter>
    </MockStateProvider>,
  )
}

function renderSwapFromState(state: MockState, initialPath: string) {
  localStorage.setItem(STORAGE_KEY, serializeMockState(state))
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <ActivePokemonProbe />
        {swapRoutes()}
      </MemoryRouter>
    </MockStateProvider>,
  )
}

function seedLiveDuel(actions: MockStateActions) {
  actions.setNickname('Ash')
  actions.receiveRoomShell({ code: 'AB12', maxPlayers: 2, status: 'waiting' })
  actions.updateTeamSelection({
    starterId: 25,
    rosterIds: [5, 23, 14, 17, 33],
  })
  actions.enterDuel('1v1')
}

function makePokemon(
  ownerId: string,
  pokemonId: string,
  overrides: Partial<DuelPokemonState> = {},
): DuelPokemonState {
  return {
    duelId: 'duel-1',
    ownerId,
    pokemonId,
    name: pokemonId,
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

// State mirroring a KO: the human active fainted, bench healthy, duel paused.
function buildForcedSwapState(): MockState {
  return {
    player: { nickname: 'Ash', playerId: null, sessionToken: null },
    room: {
      code: 'AB12',
      maxPlayers: 2,
      status: 'in_progress',
      players: [{ playerId: 'p1', nickname: 'Ash', ready: false, connected: true }],
    },
    teamSelection: {
      starterId: 25,
      rosterIds: [5, 23, 14, 17, 33],
    },
    tournament: null,
    duelPokemonState: [
      makePokemon('Ash', 'Pikachu', { currentHp: 0, isActive: false, fainted: true }),
      makePokemon('Ash', 'Snorlax'),
      makePokemon('Ash', 'Pidgey'),
      makePokemon('bot', 'rattata', { isActive: true }),
    ],
    duel: {
      duelId: 'duel-1',
      slot: '1v1',
      phase: 'awaiting_switch',
      turnNumber: 2,
      winnerId: null,
      endReason: null,
    },
  }
}

describe('SwapScreen — forced mode', () => {
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

  it('confirms a bench pokemon as the new active and returns to the duel', async () => {
    const user = userEvent.setup()
    renderSwapFromState(buildForcedSwapState(), '/swap?mode=forced')

    await user.click(screen.getByRole('button', { name: /snorlax/i }))
    await user.click(screen.getByRole('button', { name: /confirmar cambio/i }))

    expect(screen.getByText('DUEL-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('active-probe').textContent).toContain('active:Snorlax')
    expect(screen.getByTestId('active-probe').textContent).toContain('phase:awaiting_actions')
  })
})

describe('SwapScreen — voluntary mode', () => {
  it('keeps the current active pokemon and returns to the duel when canceled', async () => {
    const user = userEvent.setup()
    renderSwap('/swap?mode=voluntary', seedLiveDuel)

    await user.click(screen.getByRole('button', { name: /volver al combate/i }))

    expect(screen.getByText('DUEL-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('active-probe').textContent).toContain('active:25')
  })

  it('labels the active pokemon as currently deployed and disables it', () => {
    renderSwap('/swap?mode=voluntary', seedLiveDuel)

    expect(screen.getByText('DESPLEGADO ACTUALMENTE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pikachu/i })).toBeDisabled()
  })

  it('requires a selection before the confirm button enables', () => {
    renderSwap('/swap?mode=voluntary', seedLiveDuel)
    expect(screen.getByRole('button', { name: /confirmar cambio/i })).toBeDisabled()
  })

  it('records the swapped pokemon as active and returns to the duel board', async () => {
    const user = userEvent.setup()
    renderSwap('/swap?mode=voluntary', seedLiveDuel)

    await user.click(screen.getByRole('button', { name: /snorlax/i }))
    await user.click(screen.getByRole('button', { name: /confirmar cambio/i }))

    expect(screen.getByText('DUEL-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('active-probe').textContent).toContain('active:5')
  })
})
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import type { SeedData } from '../../data/seedData'
import TeamSelectScreen from '../TeamSelectScreen'

const seedFixture: SeedData = {
  _meta: { version: '1', description: 'test', total_starters: 4, total_catalog: 6, notes: [] },
  starters: [
    { name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
    { name: 'Charmander', type: 'fire', pokeapi_id: 4, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
    { name: 'Bulbasaur', type: 'grass', pokeapi_id: 1, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
    { name: 'Squirtle', type: 'water', pokeapi_id: 7, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
  ],
  catalog: [
    { name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
    { name: 'Pidgey', type: 'normal', pokeapi_id: 16, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
    { name: 'Charmeleon', type: 'fire', pokeapi_id: 5, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
    { name: 'Vulpix', type: 'fire', pokeapi_id: 37, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
    { name: 'Machop', type: 'fighting', pokeapi_id: 66, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
    { name: 'Abra', type: 'psychic', pokeapi_id: 63, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  ],
}

function TeamProbe() {
  const [state] = useMockState()
  return (
    <div data-testid="team-probe">
      <span data-testid="probe-starter">{state.teamSelection.starterId ?? 'none'}</span>
      <span data-testid="probe-roster">{state.teamSelection.rosterIds.join(',')}</span>
    </div>
  )
}

function renderTeamSelect() {
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/team-select']}>
        <Routes>
          <Route
            path="/team-select"
            element={
              <>
                <TeamProbe />
                <TeamSelectScreen />
              </>
            }
          />
          <Route path="/wait-room" element={<div>WAIT-ROOM-LANDED</div>} />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

function starterSection() {
  return screen.getByRole('region', { name: /elegir inicial/i })
}

function catalogSection() {
  return screen.getByRole('region', { name: /catálogo/i })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => seedFixture }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TeamSelectScreen', () => {
  it('renders all starters and the full catalog from seed data', async () => {
    renderTeamSelect()
    expect(await screen.findByText('Pikachu')).toBeInTheDocument()
    expect(screen.getByText('Charmander')).toBeInTheDocument()
    expect(screen.getByText('Bulbasaur')).toBeInTheDocument()
    expect(screen.getByText('Squirtle')).toBeInTheDocument()
    expect(within(catalogSection()).getByText('Snorlax')).toBeInTheDocument()
    expect(within(catalogSection()).getByText('Machop')).toBeInTheDocument()
    expect(within(catalogSection()).getByText('Abra')).toBeInTheDocument()
  })

  it('picks exactly one exclusive starter and blocks a second pick until deselected', async () => {
    const user = userEvent.setup()
    renderTeamSelect()
    await screen.findByText('Pikachu')

    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))
    expect(screen.getByTestId('probe-starter').textContent).toBe('Pikachu')

    // A different starter is not accepted while one is selected.
    await user.click(within(starterSection()).getByRole('button', { name: /charmander/i }))
    expect(screen.getByTestId('probe-starter').textContent).toBe('Pikachu')
    expect(screen.getByText(/deselecciona tu inicial/i)).toBeInTheDocument()

    // Deselecting the current starter unlocks a new pick.
    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))
    expect(screen.getByTestId('probe-starter').textContent).toBe('none')

    await user.click(within(starterSection()).getByRole('button', { name: /charmander/i }))
    expect(screen.getByTestId('probe-starter').textContent).toBe('Charmander')
  })

  it('allows exactly 5 roster picks and enables ready only when the team is complete', async () => {
    const user = userEvent.setup()
    renderTeamSelect()
    await screen.findByText('Pikachu')

    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))

    const readyButton = () =>
      screen.getByRole('button', { name: /listo para combatir/i })
    expect(readyButton()).toBeDisabled()

    for (const name of ['Snorlax', 'Pidgey', 'Charmeleon', 'Vulpix', 'Machop']) {
      await user.click(within(catalogSection()).getByRole('button', { name: new RegExp(name, 'i') }))
    }
    expect(screen.getByTestId('probe-roster').textContent.split(',')).toHaveLength(5)

    // A sixth pick is rejected once the roster is full.
    await user.click(within(catalogSection()).getByRole('button', { name: /abra/i }))
    expect(screen.getByTestId('probe-roster').textContent.split(',')).toHaveLength(5)
    expect(readyButton()).toBeEnabled()

    await user.click(readyButton())
    expect(screen.getByText('WAIT-ROOM-LANDED')).toBeInTheDocument()
  })

  it('filters the catalog by search and type', async () => {
    const user = userEvent.setup()
    renderTeamSelect()
    await screen.findByText('Pikachu')

    await user.type(screen.getByPlaceholderText(/buscar/i), 'vul')
    expect(within(catalogSection()).getByText('Vulpix')).toBeInTheDocument()
    expect(within(catalogSection()).queryByText('Snorlax')).not.toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText(/buscar/i))
    await user.selectOptions(screen.getByLabelText(/tipo/i), 'fire')
    expect(within(catalogSection()).getByText('Charmeleon')).toBeInTheDocument()
    expect(within(catalogSection()).getByText('Vulpix')).toBeInTheDocument()
    expect(within(catalogSection()).queryByText('Machop')).not.toBeInTheDocument()
  })

  it('shows the team panel with the live starter and roster from state', async () => {
    const user = userEvent.setup()
    renderTeamSelect()
    await screen.findByText('Pikachu')

    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))
    for (const name of ['Snorlax', 'Pidgey', 'Charmeleon', 'Vulpix', 'Machop']) {
      await user.click(within(catalogSection()).getByRole('button', { name: new RegExp(name, 'i') }))
    }
    expect(screen.getByTestId('probe-roster').textContent.split(',')).toHaveLength(5)

    const panel = screen.getByRole('complementary', { name: /tu equipo/i })
    expect(within(panel).getByText('Pikachu')).toBeInTheDocument()
    expect(within(panel).getByText('Snorlax')).toBeInTheDocument()
    expect(within(panel).getByText('Machop')).toBeInTheDocument()
    expect(screen.getByText('6/6')).toBeInTheDocument()
  })
})
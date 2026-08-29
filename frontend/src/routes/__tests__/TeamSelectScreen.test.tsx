// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import type { Pokemon } from '../../lib/catalog'
import { setCachedCatalog } from '../../lib/catalog'
import TeamSelectScreen from '../TeamSelectScreen'

const pokemonFixture: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
  { id: 4, name: 'Charmander', type: 'fire', pokeapi_id: 4, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
  { id: 1, name: 'Bulbasaur', type: 'grass', pokeapi_id: 1, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
  { id: 7, name: 'Squirtle', type: 'water', pokeapi_id: 7, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
  { id: 143, name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 16, name: 'Pidgey', type: 'normal', pokeapi_id: 16, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 5, name: 'Charmeleon', type: 'fire', pokeapi_id: 5, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 37, name: 'Vulpix', type: 'fire', pokeapi_id: 37, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 66, name: 'Machop', type: 'fighting', pokeapi_id: 66, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 63, name: 'Abra', type: 'psychic', pokeapi_id: 63, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
]

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
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
  setCachedCatalog(null)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(200, pokemonFixture)),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  setCachedCatalog(null)
})

describe('TeamSelectScreen', () => {
  it('exposes exactly one main landmark with id="main-content" (UX7)', () => {
    renderTeamSelect()
    const mains = screen.getAllByRole('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]).toHaveAttribute('id', 'main-content')
  })

  it('fetches the catalog from GET /api/pokemons and renders starters and roster', async () => {
    renderTeamSelect()
    expect(await screen.findByText('Pikachu')).toBeInTheDocument()
    expect(screen.getByText('Charmander')).toBeInTheDocument()
    expect(screen.getByText('Bulbasaur')).toBeInTheDocument()
    expect(screen.getByText('Squirtle')).toBeInTheDocument()
    expect(within(catalogSection()).getByText('Snorlax')).toBeInTheDocument()
    expect(within(catalogSection()).getByText('Machop')).toBeInTheDocument()
    expect(within(catalogSection()).getByText('Abra')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/pokemons'),
      expect.anything(),
    )
  })

  it('stores the numeric starter id in state and shows the resolved name', async () => {
    const user = userEvent.setup()
    renderTeamSelect()
    await screen.findByText('Pikachu')

    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))
    expect(screen.getByTestId('probe-starter').textContent).toBe('25')

    // A different starter is not accepted while one is selected.
    await user.click(within(starterSection()).getByRole('button', { name: /charmander/i }))
    expect(screen.getByTestId('probe-starter').textContent).toBe('25')
    expect(screen.getByText(/deselecciona tu inicial/i)).toBeInTheDocument()

    // Deselecting the current starter unlocks a new pick.
    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))
    expect(screen.getByTestId('probe-starter').textContent).toBe('none')
    await user.click(within(starterSection()).getByRole('button', { name: /charmander/i }))
    expect(screen.getByTestId('probe-starter').textContent).toBe('4')
  })

  it('allows exactly 5 roster picks with numeric ids and enables ready when complete', async () => {
    const user = userEvent.setup()
    renderTeamSelect()
    await screen.findByText('Pikachu')

    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))

    const readyButton = () =>
      screen.getByRole('button', { name: /listo para combatir/i })
    expect(readyButton()).toBeDisabled()

    for (const id of [143, 16, 5, 37, 66]) {
      const mon = pokemonFixture.find((p) => p.id === id)!
      await user.click(within(catalogSection()).getByRole('button', { name: new RegExp(mon.name, 'i') }))
    }
    expect(screen.getByTestId('probe-roster').textContent.split(',')).toEqual(['143', '16', '5', '37', '66'])

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

  it('shows the team panel resolving names from the catalog for numeric ids', async () => {
    const user = userEvent.setup()
    renderTeamSelect()
    await screen.findByText('Pikachu')

    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))
    for (const id of [143, 16, 5, 37, 66]) {
      const mon = pokemonFixture.find((p) => p.id === id)!
      await user.click(within(catalogSection()).getByRole('button', { name: new RegExp(mon.name, 'i') }))
    }
    expect(screen.getByTestId('probe-roster').textContent.split(',')).toHaveLength(5)

    const panel = screen.getByRole('complementary', { name: /tu equipo/i })
    expect(within(panel).getByText('Pikachu')).toBeInTheDocument()
    expect(within(panel).getByText('Snorlax')).toBeInTheDocument()
    expect(within(panel).getByText('Machop')).toBeInTheDocument()
    expect(screen.getByText('6/6')).toBeInTheDocument()
  })

  it('renders an error banner with manual retry when the catalog fetch fails', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
        .mockResolvedValueOnce(jsonResponse(200, pokemonFixture)),
    )
    renderTeamSelect()

    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent(/servidor/i)
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('TeamSelectScreen — catalog loading state', () => {
  it('renders skeleton placeholders in both grids while the catalog request is pending', async () => {
    let resolveFetch!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )

    renderTeamSelect()

    const starterStatus = screen.getByRole('status', { name: /cargando iniciales/i })
    const catalogStatus = screen.getByRole('status', { name: /cargando catálogo/i })
    expect(starterStatus.querySelectorAll('.pd-sprite-slot').length).toBeGreaterThanOrEqual(3)
    expect(catalogStatus.querySelectorAll('.pd-sprite-slot').length).toBeGreaterThanOrEqual(8)
    expect(screen.queryByText('Pikachu')).not.toBeInTheDocument()

    await act(async () => {
      resolveFetch(jsonResponse(200, pokemonFixture))
    })
    expect(await screen.findByText('Pikachu')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('clears the skeleton and renders both grids once the catalog resolves', async () => {
    renderTeamSelect()

    expect(await screen.findByText('Pikachu')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(within(catalogSection()).getByText('Snorlax')).toBeInTheDocument()
  })

  it('clears the skeleton and renders the error banner when the catalog fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { message: 'boom' })))

    renderTeamSelect()

    expect(await screen.findByRole('alert')).toHaveTextContent(/servidor/i)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // No skeleton and no catalog content render together with the banner.
    expect(screen.queryByText('Pikachu')).not.toBeInTheDocument()
  })

  it('reappears the skeleton on manual retry before the retried request settles', async () => {
    const user = userEvent.setup()
    let resolveRetry!: (value: Response) => void
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRetry = resolve
          }),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderTeamSelect()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(screen.getByRole('status', { name: /cargando iniciales/i })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /cargando catálogo/i })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => {
      resolveRetry(jsonResponse(200, pokemonFixture))
    })
    expect(await screen.findByText('Pikachu')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
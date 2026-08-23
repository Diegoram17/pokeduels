// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import type { Pokemon } from '../../lib/catalog'
import { setCachedCatalog } from '../../lib/catalog'
import TeamSelectScreen from '../TeamSelectScreen'
import { STORAGE_KEY, serializeMockState } from '../../state/store'
import type { MockState } from '../../state/schema'
import { io } from 'socket.io-client'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { disconnectSocket } from '../../lib/socket'

const pokemonFixture: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
  { id: 4, name: 'Charmander', type: 'fire', pokeapi_id: 4, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
  { id: 143, name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 16, name: 'Pidgey', type: 'normal', pokeapi_id: 16, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 5, name: 'Charmeleon', type: 'fire', pokeapi_id: 5, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 37, name: 'Vulpix', type: 'fire', pokeapi_id: 37, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { id: 66, name: 'Machop', type: 'fighting', pokeapi_id: 66, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
]

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function makeFakeSocket() {
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
  return fake
}

let fakeSocket: ReturnType<typeof makeFakeSocket>

function renderTeamSelect() {
  const seeded: MockState = {
    player: { nickname: 'Ash', playerId: 'p1', sessionToken: 'token-1' },
    room: { code: 'AB12', maxPlayers: 2, status: 'waiting', players: [] },
    teamSelection: { starterId: null, rosterIds: [] },
    tournament: null,
    duelPokemonState: [],
    duel: null,
  }
  localStorage.setItem(STORAGE_KEY, serializeMockState(seeded))
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/team-select']}>
        <Routes>
          <Route path="/team-select" element={<TeamSelectScreen />} />
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
  fakeSocket = makeFakeSocket()
  vi.mocked(io).mockReturnValue(fakeSocket as never)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, pokemonFixture)))
})

afterEach(() => {
  vi.unstubAllGlobals()
  setCachedCatalog(null)
  disconnectSocket()
  vi.clearAllMocks()
})

describe('TeamSelectScreen WS', () => {
  it('emits team:select_starter with the numeric id when a starter is picked', async () => {
    const user = userEvent.setup()
    renderTeamSelect()
    await screen.findByText('Pikachu')

    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))

    await waitFor(() => {
      expect(fakeSocket.emit).toHaveBeenCalledWith('team:select_starter', { pokemonId: 25 })
    })
  })

  it('emits team:select_roster with numeric ids once five roster picks are made', async () => {
    const user = userEvent.setup()
    renderTeamSelect()
    await screen.findByText('Pikachu')

    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))
    for (const id of [143, 16, 5, 37, 66]) {
      const mon = pokemonFixture.find((p) => p.id === id)!
      await user.click(within(catalogSection()).getByRole('button', { name: new RegExp(mon.name, 'i') }))
    }

    await waitFor(() => {
      expect(fakeSocket.emit).toHaveBeenCalledWith('team:select_roster', {
        pokemonIds: [143, 16, 5, 37, 66],
      })
    })
  })

  it('renders an error banner when the server rejects the starter', async () => {
    const user = userEvent.setup()
    renderTeamSelect()
    await screen.findByText('Pikachu')
    await waitFor(() => {
      expect(fakeSocket.on).toHaveBeenCalledWith('team:starter_rejected', expect.any(Function))
    })

    await user.click(within(starterSection()).getByRole('button', { name: /pikachu/i }))
    fakeSocket._fire('team:starter_rejected', { pokemonId: 25, reason: 'taken' })

    expect(await screen.findByRole('alert')).toHaveTextContent(/rechazad|no disponible|tomad/i)
  })

  it('renders an error banner when the server rejects the roster', async () => {
    renderTeamSelect()
    await screen.findByText('Pikachu')
    await waitFor(() => {
      expect(fakeSocket.on).toHaveBeenCalledWith('team:roster_rejected', expect.any(Function))
    })

    fakeSocket._fire('team:roster_rejected', { pokemonIds: [143, 16], reason: 'duplicate' })

    expect(await screen.findByRole('alert')).toHaveTextContent(/rechazad|duplicad/i)
  })
})
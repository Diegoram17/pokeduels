// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import LobbyScreen from '../LobbyScreen'
import { setSessionToken } from '../../lib/api'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

const waitingRooms = [
  { id: 'r1', code: 'AB12', max_players: 2, status: 'waiting', player_count: 1 },
  { id: 'r2', code: 'Z009', max_players: 4, status: 'waiting', player_count: 2 },
]

function renderLobby() {
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/lobby']}>
        <Routes>
          <Route
            path="/lobby"
            element={
              <>
                <LobbyScreen />
              </>
            }
          />
          <Route path="/team-select" element={<div>TEAM-SELECT-LANDED</div>} />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

beforeEach(() => {
  setSessionToken('token-1')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  setSessionToken(null)
})

describe('LobbyScreen', () => {
  it('lists the waiting rooms from GET /api/rooms with their derived mode label', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, waitingRooms))

    renderLobby()

    expect(await screen.findByText('#AB12')).toBeInTheDocument()
    expect(screen.getByText('#Z009')).toBeInTheDocument()
    expect(screen.getByText('DUELO 1V1')).toBeInTheDocument()
    expect(screen.getByText('TORNEO DE 4')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText('2/4')).toBeInTheDocument()
  })

  it('creates a 1v1 room via POST /api/rooms and navigates to team select', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 'r9', code: 'NEW1', max_players: 2, status: 'waiting' }),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderLobby()
    await screen.findByText('SALAS DE BATALLA')

    await user.click(screen.getByRole('button', { name: /duelo individual/i }))

    expect(await screen.findByText('TEAM-SELECT-LANDED')).toBeInTheDocument()
    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes('/api/rooms') && call[1]?.method === 'POST',
    )
    expect(createCall).toBeDefined()
    expect(JSON.parse(createCall![1].body)).toEqual({ max_players: 2 })
  })

  it('creates a tournament room via POST /api/rooms with max_players 4', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 'r9', code: 'NEW4', max_players: 4, status: 'waiting' }),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderLobby()
    await screen.findByText('SALAS DE BATALLA')

    await user.click(screen.getByRole('button', { name: /torneo de entrenadores/i }))

    expect(await screen.findByText('TEAM-SELECT-LANDED')).toBeInTheDocument()
    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes('/api/rooms') && call[1]?.method === 'POST',
    )
    expect(JSON.parse(createCall![1].body)).toEqual({ max_players: 4 })
  })

  it('joins a room by code via POST /api/rooms/:code/join with the nickname', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 'r1', code: 'AB12', max_players: 2, status: 'waiting' }),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderLobby()
    await screen.findByText('SALAS DE BATALLA')

    await user.type(screen.getByPlaceholderText(/código de sala/i), 'ab12')
    await user.click(screen.getByRole('button', { name: /unirse/i }))

    expect(await screen.findByText('TEAM-SELECT-LANDED')).toBeInTheDocument()
    const joinCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('/api/rooms/AB12/join'),
    )
    expect(joinCall).toBeDefined()
    expect(JSON.parse(joinCall![1].body)).toEqual({ nickname: '' })
  })

  it('joins a listed waiting room via its UNIRSE button', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, waitingRooms))
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 'r1', code: 'AB12', max_players: 2, status: 'waiting' }),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderLobby()
    await screen.findByText('#AB12')

    const card = screen.getByText('#AB12').closest('.room-card') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /unirse a la sala/i }))

    expect(await screen.findByText('TEAM-SELECT-LANDED')).toBeInTheDocument()
    const joinCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('/api/rooms/AB12/join'),
    )
    expect(joinCall).toBeDefined()
  })

  it('disables the join button on a full listed room', async () => {
    const fullRooms = [
      { id: 'r1', code: 'AB12', max_players: 2, status: 'waiting', player_count: 2 },
    ]
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, fullRooms))

    renderLobby()
    await screen.findByText('#AB12')

    expect(screen.getByRole('button', { name: /sala llena/i })).toBeDisabled()
  })

  it('renders an error banner with retry when the room list fails to load', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, { message: 'boom' }))

    renderLobby()

    expect(await screen.findByRole('alert')).toHaveTextContent(/servidor/i)
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
  })

  it('shows an error banner and does not navigate when join returns 409 (room full)', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(409, { message: 'room is full' }))
    vi.stubGlobal('fetch', fetchMock)

    renderLobby()
    await screen.findByText('SALAS DE BATALLA')

    await user.type(screen.getByPlaceholderText(/código de sala/i), 'AB12')
    await user.click(screen.getByRole('button', { name: /unirse/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/llena/i)
    expect(screen.queryByText('TEAM-SELECT-LANDED')).not.toBeInTheDocument()
  })

  it('retries the room list when the banner retry button is clicked', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, waitingRooms))
    vi.stubGlobal('fetch', fetchMock)

    renderLobby()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByText('#AB12')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('LobbyScreen — room list loading state', () => {
  it('renders skeleton placeholders while the room list request is pending and keeps lobby controls interactive', async () => {
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

    renderLobby()

    const status = screen.getByRole('status', { name: /cargando salas/i })
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status.querySelectorAll('.pd-sprite-slot').length).toBeGreaterThanOrEqual(4)
    // Only the room-list area is gated; create/join controls stay interactive.
    expect(screen.getByRole('button', { name: /duelo individual/i })).toBeEnabled()
    expect(screen.getByPlaceholderText(/código de sala/i)).toBeEnabled()

    await act(async () => {
      resolveFetch(jsonResponse(200, waitingRooms))
    })
    expect(await screen.findByText('#AB12')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /cargando salas/i })).not.toBeInTheDocument()
  })

  it('clears the skeleton and renders the room list once the request resolves', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, waitingRooms))

    renderLobby()

    expect(await screen.findByText('#AB12')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /cargando salas/i })).not.toBeInTheDocument()
  })

  it('clears the skeleton and renders the error banner when the request fails', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, { message: 'boom' }))

    renderLobby()

    expect(await screen.findByRole('alert')).toHaveTextContent(/servidor/i)
    expect(screen.queryByRole('status', { name: /cargando salas/i })).not.toBeInTheDocument()
    // No skeleton and no room grid (nor its empty state) render with the banner.
    expect(screen.queryByText('No hay salas esperando entrenadores')).not.toBeInTheDocument()
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

    renderLobby()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(screen.getByRole('status', { name: /cargando salas/i })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => {
      resolveRetry(jsonResponse(200, waitingRooms))
    })
    expect(await screen.findByText('#AB12')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /cargando salas/i })).not.toBeInTheDocument()
  })
})
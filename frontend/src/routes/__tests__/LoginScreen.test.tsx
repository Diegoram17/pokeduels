// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import LoginScreen from '../LoginScreen'
import { setSessionToken } from '../../lib/api'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function SessionProbe() {
  const [state] = useMockState()
  return (
    <div data-testid="session-probe">
      <span data-testid="probe-nickname">{state.player.nickname}</span>
      <span data-testid="probe-player-id">{state.player.playerId ?? 'none'}</span>
      <span data-testid="probe-token">{state.player.sessionToken ?? 'none'}</span>
    </div>
  )
}

function renderLogin() {
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LoginScreen />} />
          <Route
            path="/lobby"
            element={
              <>
                <div>LOBBY-LANDED</div>
                <SessionProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

beforeEach(() => {
  setSessionToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setSessionToken(null)
})

describe('LoginScreen', () => {
  it('exposes exactly one main landmark with id="main-content" (UX7)', () => {
    renderLogin()
    const mains = screen.getAllByRole('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]).toHaveAttribute('id', 'main-content')
  })

  it('renders the arena background as a static image', () => {
    renderLogin()
    const img = screen.getByRole('img', { name: /fondo de la arena/i })
    expect(img.getAttribute('src')).toContain('login-bg')
  })

  it('creates a backend session, stores playerId/sessionToken and navigates to the lobby', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, { playerId: 'player-1', sessionToken: 'token-1' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderLogin()
    await user.type(screen.getByPlaceholderText(/apodo/i), '  Ash  ')
    await user.click(screen.getByRole('button', { name: /entrar a jugar/i }))

    expect(screen.getByText('LOBBY-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('probe-nickname').textContent).toBe('Ash')
    expect(screen.getByTestId('probe-player-id').textContent).toBe('player-1')
    expect(screen.getByTestId('probe-token').textContent).toBe('token-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/session')
    expect(JSON.parse(init.body)).toEqual({ nickname: '  Ash  ' })
  })

  it('shows an inline error banner with retry and does not navigate on failure', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(500, { message: 'boom' })),
    )

    renderLogin()
    await user.type(screen.getByPlaceholderText(/apodo/i), 'Ash')
    await user.click(screen.getByRole('button', { name: /entrar a jugar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/servidor/i)
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
    expect(screen.queryByText('LOBBY-LANDED')).not.toBeInTheDocument()
  })

  it('retries the session request when the banner retry button is clicked', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
      .mockResolvedValueOnce(
        jsonResponse(201, { playerId: 'player-1', sessionToken: 'token-1' }),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderLogin()
    await user.type(screen.getByPlaceholderText(/apodo/i), 'Ash')
    await user.click(screen.getByRole('button', { name: /entrar a jugar/i }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByText('LOBBY-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('probe-token').textContent).toBe('token-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('blocks a 2-character nickname with a validation error and no network call', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderLogin()
    await user.type(screen.getByPlaceholderText(/apodo/i), 'Ab')
    await user.click(screen.getByRole('button', { name: /entrar a jugar/i }))

    expect(screen.getByText(/al menos 3 caracteres/i)).toBeInTheDocument()
    expect(screen.queryByText('LOBBY-LANDED')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
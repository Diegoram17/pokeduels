// @vitest-environment jsdom
// F3 (room:aborted recovery, ADR-0008): the App-level global banner is gated
// on state.roomAborted. The player may be on any screen (here: an active duel
// board) when the backend tears the room down; the UI must show an explicit
// recovery banner with a manual "back to lobby" button — no silent
// auto-redirect (product decision, obs #284).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import App from '../../App'
import { STORAGE_KEY, serializeMockState } from '../../state/store'
import type { MockState } from '../../state/schema'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { disconnectSocket } from '../../lib/socket'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

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

/** A player mid-duel (stale screen) whose room was aborted by a backend restart. */
function abortedMidDuelState(): MockState {
  return {
    player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
    room: {
      code: 'AB12',
      maxPlayers: 2,
      status: 'in_progress',
      players: [
        { playerId: '10', nickname: 'Ash', ready: true, connected: true },
        { playerId: '11', nickname: 'Misty', ready: true, connected: true },
      ],
    },
    teamSelection: { starterId: 25, rosterIds: [5, 6, 23] },
    tournament: null,
    duelPokemonState: [
      { duelId: '42', ownerId: 10, pokemonId: 25, name: 'Pikachu', type: 'electric', spriteUrl: 'front-pikachu', backSpriteUrl: 'back-pikachu', currentHp: 75, ppMove1: 3, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
      { duelId: '42', ownerId: 11, pokemonId: 23, name: 'Pidgeot', type: 'flying', spriteUrl: 'front-pidgeot', backSpriteUrl: 'back-pidgeot', currentHp: 75, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
    ],
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
    pendingDuelId: null,
    finalRanking: null,
    roomAborted: { reason: 'server_restart' },
  }
}

function renderApp() {
  localStorage.setItem(STORAGE_KEY, serializeMockState(abortedMidDuelState()))
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/duel']}>
        <App />
      </MemoryRouter>
    </MockStateProvider>,
  )
}

beforeEach(() => {
  fakeSocket = makeFakeSocket()
  vi.mocked(io).mockReturnValue(fakeSocket as never)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  disconnectSocket()
  document.documentElement.removeAttribute('lang')
})

describe('App — room:aborted global recovery banner (F3)', () => {
  it('shows the recovery banner with the reason and a VOLVER AL LOBBY button while the stale screen stays mounted', () => {
    renderApp()

    expect(screen.getByRole('alert')).toHaveTextContent('server_restart')
    expect(
      screen.getByRole('button', { name: 'VOLVER AL LOBBY' }),
    ).toBeInTheDocument()
    // No silent auto-redirect: the player is still on the duel board.
    expect(screen.getByTestId('hud-human')).toBeInTheDocument()
  })

  it('navigates to the lobby and clears the aborted state when VOLVER AL LOBBY is clicked', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole('button', { name: 'VOLVER AL LOBBY' }))

    // Landed on the lobby screen.
    expect(await screen.findByText('SALAS DE BATALLA')).toBeInTheDocument()
    // The recovery banner is gone — state.roomAborted was acknowledged.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'VOLVER AL LOBBY' })).not.toBeInTheDocument()
  })

  it('preserves the document locale during client-side navigation', async () => {
    const user = userEvent.setup()
    document.documentElement.setAttribute('lang', 'es')
    renderApp()

    expect(document.documentElement).toHaveAttribute('lang', 'es')

    await user.click(screen.getByRole('button', { name: 'VOLVER AL LOBBY' }))

    expect(await screen.findByText('SALAS DE BATALLA')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('lang', 'es')
  })

it('does not render the banner when no abort is recorded', () => {
    const clean = abortedMidDuelState()
    clean.roomAborted = null
    localStorage.setItem(STORAGE_KEY, serializeMockState(clean))
    render(
      <MockStateProvider>
        <MemoryRouter initialEntries={['/duel']}>
          <App />
        </MemoryRouter>
      </MockStateProvider>,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-human')).toBeInTheDocument()
  })
})

describe('App — skip link (UX7)', () => {
  it('focuses the skip link on the first Tab press and points it at the main content region', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.tab()

    const skipLink = screen.getByRole('link', { name: /saltar al contenido/i })
    expect(skipLink).toHaveFocus()
    expect(skipLink).toHaveAttribute('href', '#main-content')
  })
})

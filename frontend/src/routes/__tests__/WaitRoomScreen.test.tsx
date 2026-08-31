// @vitest-environment jsdom
// #10 PR 2 rewrite: non-WS presentation tests for WaitRoomScreen — roster with
// bot fillers, slot/mode labels, bracket visibility and navigation guards.
// WS behaviors (rematch panel, pending-duel entry, real bracket) live in
// WaitRoomScreen.ws.test.tsx.

import { describe, it, expect, vi } from 'vitest'
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import type { MockStateActions } from '../../state/useMockState'
import WaitRoomScreen from '../WaitRoomScreen'
import { createBot } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, createBot: vi.fn() }
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

function WaitForRoom({ children }: { children: ReactNode }) {
  const [state] = useMockState()
  if (!state.room) return <div>setting-up-room</div>
  return <>{children}</>
}

function renderWaitRoom(seed?: (actions: MockStateActions) => void) {
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/wait-room']}>
        <SeedProbe seed={seed} />
        <Routes>
          <Route
            path="/wait-room"
            element={
              <WaitForRoom>
                <WaitRoomScreen />
              </WaitForRoom>
            }
          />
          <Route path="/duel" element={<div>DUEL-LANDED</div>} />
          <Route path="/lobby" element={<div>LOBBY-LANDED</div>} />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

function seedRoom(maxPlayers: 2 | 4, players: { playerId: string; nickname: string }[]) {
  return (actions: MockStateActions) => {
    actions.setNickname('Ash')
    actions.receiveRoomShell({ code: 'AB12', maxPlayers, status: 'waiting' })
    actions.receiveRoomState({
      code: 'AB12',
      maxPlayers,
      status: 'waiting',
      players: players.map((p) => ({ ...p, ready: false, connected: true })),
    })
  }
}

describe('WaitRoomScreen', () => {
  it('exposes exactly one main landmark with id="main-content" (UX7)', () => {
    renderWaitRoom(seedRoom(2, [{ playerId: 'p1', nickname: 'Ash' }]))
    const mains = screen.getAllByRole('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]).toHaveAttribute('id', 'main-content')
  })

  it('shows the player list with real players for a 1v1 room', () => {
    renderWaitRoom(seedRoom(2, [{ playerId: 'p1', nickname: 'Ash' }]))

    const playerList = screen.getByTestId('player-list')
    expect(within(playerList).getByText('Ash')).toBeInTheDocument()
    // Counter shows actual players (1/2), not filled with fake bots
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('labels a 1v1 room DUELO 1V1 and hides the bracket', () => {
    renderWaitRoom(seedRoom(2, [{ playerId: 'p1', nickname: 'Ash' }]))

    expect(screen.getByTestId('slot-label')).toHaveTextContent('DUELO 1V1')
    expect(screen.queryByRole('region', { name: /cuadro/i })).not.toBeInTheDocument()
  })

  it('labels a tournament room TORNEO DE 4 and hides the bracket until a broadcast lands', () => {
    renderWaitRoom(seedRoom(4, [{ playerId: 'p1', nickname: 'Ash' }]))

    expect(screen.getByTestId('slot-label')).toHaveTextContent('TORNEO DE 4')
    expect(screen.queryByRole('region', { name: /cuadro/i })).not.toBeInTheDocument()
    // Counter shows actual players (1/4), not filled with fake bots
    expect(screen.getByText('1 / 4')).toBeInTheDocument()
  })

  it('leaves the room and returns to the lobby', async () => {
    const user = userEvent.setup()
    renderWaitRoom(seedRoom(2, [{ playerId: 'p1', nickname: 'Ash' }]))
    await user.click(screen.getByRole('button', { name: /salir de la sala/i }))
    expect(screen.getByText('LOBBY-LANDED')).toBeInTheDocument()
  })

  it('redirects to the lobby when no room is set', () => {
    render(
      <MockStateProvider>
        <MemoryRouter initialEntries={['/wait-room']}>
          <SeedProbe seed={(actions) => actions.setNickname('Ash')} />
          <Routes>
            <Route path="/wait-room" element={<WaitRoomScreen />} />
            <Route path="/lobby" element={<div>LOBBY-LANDED</div>} />
          </Routes>
        </MemoryRouter>
      </MockStateProvider>,
    )
    expect(screen.getByText('LOBBY-LANDED')).toBeInTheDocument()
  })
})

describe('WaitRoomScreen — single LISTO action (no separate start button)', () => {
  it('renders only the LISTO toggle once the room is full — no duplicate INICIAR PARTIDA', () => {
    renderWaitRoom(
      seedRoom(2, [
        { playerId: 'p1', nickname: 'Ash' },
        { playerId: 'p2', nickname: 'Misty' },
      ]),
    )
    expect(screen.queryByRole('button', { name: /iniciar partida/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /listo/i })).toBeInTheDocument()
  })
})

describe('BotManager', () => {
  it('shows a single AGREGAR BOT button for a tournament room with multiple empty slots', () => {
    renderWaitRoom(seedRoom(4, [{ playerId: 'p1', nickname: 'Ash' }]))
    expect(screen.getByRole('button', { name: /agregar bot/i })).toBeInTheDocument()
  })

  it('shows AGREGAR BOT for a tournament room with a single empty slot', () => {
    renderWaitRoom(
      seedRoom(4, [
        { playerId: 'p1', nickname: 'Ash' },
        { playerId: 'p2', nickname: 'Misty' },
        { playerId: 'p3', nickname: 'Brock' },
      ]),
    )
    expect(screen.getByRole('button', { name: /agregar bot/i })).toBeInTheDocument()
  })

  it('shows AGREGAR BOT for a 1v1 room (single empty slot)', () => {
    renderWaitRoom(seedRoom(2, [{ playerId: 'p1', nickname: 'Ash' }]))
    expect(screen.getByRole('button', { name: /agregar bot/i })).toBeInTheDocument()
  })

  it('adds exactly one bot per click, even when several seats are empty', async () => {
    const user = userEvent.setup()
    renderWaitRoom(seedRoom(4, [{ playerId: 'p1', nickname: 'Ash' }]))
    await user.click(screen.getByRole('button', { name: /agregar bot/i }))
    expect(createBot).toHaveBeenCalledTimes(1)
    expect(createBot).toHaveBeenCalledWith('AB12')
  })

  it('is hidden when the room is full', () => {
    renderWaitRoom(
      seedRoom(2, [
        { playerId: 'p1', nickname: 'Ash' },
        { playerId: 'p2', nickname: 'Misty' },
      ]),
    )
    expect(screen.queryByRole('button', { name: /agregar bot/i })).not.toBeInTheDocument()
  })
})

describe('WaitRoomScreen — player ready indicators', () => {
  it('shows a ready check only on players who are actually ready', () => {
    renderWaitRoom((actions) => {
      actions.setNickname('Ash')
      actions.receiveRoomShell({ code: 'AB12', maxPlayers: 2, status: 'waiting' })
      actions.receiveRoomState({
        code: 'AB12',
        maxPlayers: 2,
        status: 'waiting',
        players: [
          { playerId: 'p1', nickname: 'Ash', ready: true, connected: true },
          { playerId: 'p2', nickname: 'Misty', ready: false, connected: true },
        ],
      })
    })

    const playerList = screen.getByTestId('player-list')
    expect(within(playerList).getAllByText('check_circle')).toHaveLength(1)
    expect(within(playerList).getByText('Misty')).toBeInTheDocument()
  })
})

describe('WaitRoomScreen — wait re-skin (PR5)', () => {
  it('applies the wait structure: wait-main row, wait-side rail, player rows with ready/pending states', () => {
    const { container } = renderWaitRoom((actions) => {
      actions.setNickname('Ash')
      actions.receiveRoomShell({ code: 'AB12', maxPlayers: 2, status: 'waiting' })
      actions.receiveRoomState({
        code: 'AB12',
        maxPlayers: 2,
        status: 'waiting',
        players: [
          { playerId: 'p1', nickname: 'Ash', ready: true, connected: true },
          { playerId: 'p2', nickname: 'Misty', ready: false, connected: true },
        ],
      })
    })

    expect(container.querySelector('.wait-main')).not.toBeNull()
    expect(container.querySelector('.wait-side')).not.toBeNull()
    expect(container.querySelector('.player-row--ready')).not.toBeNull()
    expect(container.querySelector('.player-row--pending')).not.toBeNull()
  })

  it('colors the LISTO toggle with var(--pd-yellow), never the off-palette #22c55e', () => {
    renderWaitRoom((actions) => {
      actions.setNickname('Ash')
      actions.receiveRoomShell({ code: 'AB12', maxPlayers: 2, status: 'waiting' })
      actions.receiveRoomState({
        code: 'AB12',
        maxPlayers: 2,
        status: 'waiting',
        players: [{ playerId: 'p1', nickname: 'Ash', ready: true, connected: true }],
      })
    })

    const readyBtn = screen.getByRole('button', { name: /listo/i })
    expect(readyBtn).toBeInTheDocument()
    expect(readyBtn.style.background).not.toContain('#22c55e')
    expect(readyBtn.style.borderColor).not.toContain('#22c55e')
  })
})
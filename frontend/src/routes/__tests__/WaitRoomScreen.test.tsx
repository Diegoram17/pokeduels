// @vitest-environment jsdom
// #10 PR 2 rewrite: non-WS presentation tests for WaitRoomScreen — roster with
// bot fillers, slot/mode labels, bracket visibility and navigation guards.
// WS behaviors (rematch panel, pending-duel entry, real bracket) live in
// WaitRoomScreen.ws.test.tsx.

import { describe, it, expect } from 'vitest'
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import type { MockStateActions } from '../../state/useMockState'
import WaitRoomScreen from '../WaitRoomScreen'

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

describe('StartMatchButton', () => {
  it('is hidden when the room is not full', () => {
    renderWaitRoom(seedRoom(2, [{ playerId: 'p1', nickname: 'Ash' }]))
    expect(screen.queryByRole('button', { name: /iniciar partida/i })).not.toBeInTheDocument()
  })

  it('is shown when the room is full and the player is not ready yet', () => {
    renderWaitRoom(
      seedRoom(2, [
        { playerId: 'p1', nickname: 'Ash' },
        { playerId: 'p2', nickname: 'Misty' },
      ]),
    )
    expect(screen.getByRole('button', { name: /iniciar partida/i })).toBeInTheDocument()
  })

  it('is hidden when the player is already ready', () => {
    renderWaitRoom((actions) => {
      actions.sessionEstablished({ playerId: 'p1', sessionToken: 't1', nickname: 'Ash' })
      actions.receiveRoomShell({ code: 'AB12', maxPlayers: 2, status: 'waiting' })
      actions.receiveRoomState({
        code: 'AB12',
        maxPlayers: 2,
        status: 'waiting',
        players: [
          { playerId: 'p1', nickname: 'Ash', ready: true, connected: true },
          { playerId: 'p2', nickname: 'Misty', ready: true, connected: true },
        ],
      })
    })
    expect(screen.queryByRole('button', { name: /iniciar partida/i })).not.toBeInTheDocument()
  })
})

describe('BotManager', () => {
  it('shows AGREGAR BOTS for a tournament room with multiple empty slots', () => {
    renderWaitRoom(seedRoom(4, [{ playerId: 'p1', nickname: 'Ash' }]))
    expect(screen.getByRole('button', { name: /agregar bots/i })).toBeInTheDocument()
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
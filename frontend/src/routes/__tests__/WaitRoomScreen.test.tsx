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
  it('shows the player list with the real roster and bot fillers for a 1v1 room', () => {
    renderWaitRoom(seedRoom(2, [{ playerId: 'p1', nickname: 'Ash' }]))

    const playerList = screen.getByTestId('player-list')
    expect(within(playerList).getByText('Ash')).toBeInTheDocument()
    expect(within(playerList).getByText('VORTEX_99')).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
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
    expect(screen.getByText('4 / 4')).toBeInTheDocument()
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
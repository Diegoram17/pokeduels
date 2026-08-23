// @vitest-environment jsdom
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

// Mirrors the real flow: the wait room only mounts once a room exists, so the
// screen's own redirect guard does not fire before the seed settles.
function WaitForRoom({ children }: { children: ReactNode }) {
  const [state] = useMockState()
  if (!state.room) return <div>setting-up-room</div>
  return <>{children}</>
}

function DuelProbe() {
  const [state] = useMockState()
  return (
    <span data-testid="duel-slot-probe">
      {state.duel?.slot ?? 'none'}
    </span>
  )
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
          <Route
            path="/duel"
            element={
              <>
                <DuelProbe />
                <div>DUEL-LANDED</div>
              </>
            }
          />
          <Route path="/lobby" element={<div>LOBBY-LANDED</div>} />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

function seedTournament(actions: MockStateActions) {
  actions.setNickname('Ash')
  actions.createRoom('tournament', 4)
  actions.updateTeamSelection({
    starterId: 25,
    rosterIds: [5, 6, 14, 17, 23],
  })
}

function seed1v1(actions: MockStateActions) {
  actions.setNickname('Ash')
  actions.createRoom('1v1', 2)
  actions.updateTeamSelection({
    starterId: 25,
    rosterIds: [5, 6, 14, 17, 23],
  })
}

describe('WaitRoomScreen', () => {
  it('shows the active tournament slot label and the player list with bot fillers', () => {
    renderWaitRoom(seedTournament)
    expect(screen.getByText('SEMIFINAL A')).toBeInTheDocument()
    const playerList = screen.getByTestId('player-list')
    expect(within(playerList).getByText('Ash')).toBeInTheDocument()
    expect(within(playerList).getByText('VORTEX_99')).toBeInTheDocument()
    expect(within(playerList).getByText('STEALTH_OP')).toBeInTheDocument()
    expect(within(playerList).getByText('CYBER_RONIN')).toBeInTheDocument()
    expect(screen.getByText('4 / 4')).toBeInTheDocument()
  })

  it('shows the semifinal pairings in the bracket for a tournament room', () => {
    renderWaitRoom(seedTournament)
    const bracket = screen.getByRole('region', { name: /cuadro/i })
    expect(within(bracket).getByText('VORTEX_99')).toBeInTheDocument()
    expect(within(bracket).getByText('STEALTH_OP')).toBeInTheDocument()
    expect(within(bracket).getByText('CYBER_RONIN')).toBeInTheDocument()
  })

  it('hides the bracket and labels the slot DUELO 1V1 for a 1v1 room', () => {
    renderWaitRoom(seed1v1)
    expect(screen.getByText('DUELO 1V1')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /cuadro/i })).not.toBeInTheDocument()
  })

  it('enters the duel and navigates to the duel board', async () => {
    const user = userEvent.setup()
    renderWaitRoom(seedTournament)
    await user.click(screen.getByRole('button', { name: /entrar al combate/i }))
    expect(screen.getByText('DUEL-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('duel-slot-probe').textContent).toBe('semiA')
  })

  it('leaves the room and returns to the lobby', async () => {
    const user = userEvent.setup()
    renderWaitRoom(seedTournament)
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
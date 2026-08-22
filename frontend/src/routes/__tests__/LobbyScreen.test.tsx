// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import type { MockStateActions } from '../../state/useMockState'
import LobbyScreen from '../LobbyScreen'

function SeedProbe({ seed }: { seed?: (actions: MockStateActions) => void }) {
  const [, actions] = useMockState()
  const seeded = useRef(false)
  if (!seeded.current && seed) {
    seeded.current = true
    seed(actions)
  }
  return null
}

function StateProbe() {
  const [state] = useMockState()
  return (
    <div data-testid="state-probe">
      <span data-testid="probe-nickname">{state.player.nickname}</span>
      <span data-testid="probe-room-mode">{state.room?.mode ?? 'none'}</span>
      <span data-testid="probe-room-max">{state.room?.maxPlayers ?? 'none'}</span>
      <span data-testid="probe-room-code">{state.room?.code ?? 'none'}</span>
    </div>
  )
}

function renderLobby(seed?: (actions: MockStateActions) => void) {
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/lobby']}>
        <SeedProbe seed={seed} />
        <Routes>
          <Route
            path="/lobby"
            element={
              <>
                <StateProbe />
                <LobbyScreen />
              </>
            }
          />
          <Route
            path="/team-select"
            element={
              <>
                <StateProbe />
                <div>TEAM-SELECT-LANDED</div>
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

function seedNickname(actions: MockStateActions) {
  actions.setNickname('Ash')
}

describe('LobbyScreen', () => {
  it('renders the current room from mock state with its code, mode and player count', () => {
    renderLobby((actions) => {
      actions.setNickname('Ash')
      actions.createRoom('1v1', 2)
    })
    expect(screen.getByTestId('room-code').textContent).toMatch(/^#[A-Z0-9]{4}$/)
    expect(screen.getByText('DUELO 1V1')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('creates a 1v1 room and navigates to team select', async () => {
    const user = userEvent.setup()
    renderLobby(seedNickname)
    await user.click(screen.getByRole('button', { name: /duelo individual/i }))
    expect(screen.getByText('TEAM-SELECT-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('probe-room-mode').textContent).toBe('1v1')
    expect(screen.getByTestId('probe-room-max').textContent).toBe('2')
  })

  it('creates a tournament room storing mode tournament and maxPlayers 4', async () => {
    const user = userEvent.setup()
    renderLobby(seedNickname)
    await user.click(screen.getByRole('button', { name: /torneo de entrenadores/i }))
    expect(screen.getByText('TEAM-SELECT-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('probe-room-mode').textContent).toBe('tournament')
    expect(screen.getByTestId('probe-room-max').textContent).toBe('4')
  })

  it('joins a room when the typed code matches the room in state', async () => {
    const user = userEvent.setup()
    renderLobby((actions) => {
      actions.setNickname('Ash')
      actions.createRoom('1v1', 2)
    })
    const code = screen.getByTestId('room-code').textContent!.replace('#', '')
    await user.type(screen.getByPlaceholderText(/código de sala/i), code)
    await user.click(screen.getByRole('button', { name: /unirse/i }))
    expect(screen.getByText('TEAM-SELECT-LANDED')).toBeInTheDocument()
  })

  it('rejects an unknown code with an error and no navigation', async () => {
    const user = userEvent.setup()
    renderLobby((actions) => {
      actions.setNickname('Ash')
      actions.createRoom('1v1', 2)
    })
    await user.type(screen.getByPlaceholderText(/código de sala/i), 'ZZ99')
    await user.click(screen.getByRole('button', { name: /unirse/i }))
    expect(screen.getByText(/no se encontró una sala/i)).toBeInTheDocument()
    expect(screen.queryByText('TEAM-SELECT-LANDED')).not.toBeInTheDocument()
  })

  it('updates the nickname via the change-nickname control', async () => {
    const user = userEvent.setup()
    renderLobby(seedNickname)
    expect(screen.getByTestId('probe-nickname').textContent).toBe('Ash')
    await user.click(screen.getByRole('button', { name: /cambiar apodo/i }))
    await user.type(screen.getByPlaceholderText(/nuevo apodo/i), 'Red')
    await user.click(screen.getByRole('button', { name: /guardar/i }))
    expect(screen.getByTestId('probe-nickname').textContent).toBe('Red')
  })

  it('does not update the nickname when the new value is invalid', async () => {
    const user = userEvent.setup()
    renderLobby(seedNickname)
    await user.click(screen.getByRole('button', { name: /cambiar apodo/i }))
    await user.type(screen.getByPlaceholderText(/nuevo apodo/i), 'Ab')
    await user.click(screen.getByRole('button', { name: /guardar/i }))
    expect(screen.getByText(/al menos 3 caracteres/i)).toBeInTheDocument()
    expect(screen.getByTestId('probe-nickname').textContent).toBe('Ash')
  })
})
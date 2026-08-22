// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import type { MockStateActions } from '../../state/useMockState'
import DuelBoardScreen from '../DuelBoardScreen'

function SeedProbe({ seed }: { seed?: (actions: MockStateActions) => void }) {
  const [, actions] = useMockState()
  const seeded = useRef(false)
  if (!seeded.current && seed) {
    seeded.current = true
    seed(actions)
  }
  return null
}

function DuelPhaseProbe() {
  const [state] = useMockState()
  return (
    <span data-testid="duel-probe">
      phase:{state.duel?.phase ?? 'none'}|winner:{state.duel?.winnerId ?? 'none'}
      |turn:{state.duel?.turnNumber ?? 'none'}
    </span>
  )
}

function SwapModeProbe() {
  const [state] = useMockState()
  return (
    <span data-testid="swap-probe">
      mode:{new URLSearchParams(window.location.search).get('mode') ?? 'none'}
      |active:{state.duelPokemonState.find((p) => p.isActive)?.pokemonId ?? 'none'}
    </span>
  )
}

// The duel board redirects when no duel exists, and the seed runs during the
// first render pass — so wait until the seeded duel lands before mounting it.
function WaitForDuel({ children }: { children: ReactNode }) {
  const [state] = useMockState()
  if (!state.duel) return <div>setting-up-duel</div>
  return <>{children}</>
}

function renderDuelBoard(seed?: (actions: MockStateActions) => void) {
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/duel']}>
        <SeedProbe seed={seed} />
        <Routes>
          <Route
            path="/duel"
            element={
              <>
                <WaitForDuel>
                  <DuelBoardScreen />
                </WaitForDuel>
                <DuelPhaseProbe />
              </>
            }
          />
          <Route
            path="/swap"
            element={
              <>
                <SwapModeProbe />
                <div>SWAP-LANDED</div>
              </>
            }
          />
          <Route path="/wait-room" element={<div>WAIT-LANDED</div>} />
          <Route path="/ranking" element={<div>RANKING-LANDED</div>} />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

function seed1v1Duel(actions: MockStateActions) {
  actions.setNickname('Ash')
  actions.createRoom('1v1', 2)
  actions.updateTeamSelection({
    starterId: 'Pikachu',
    rosterIds: ['Snorlax', 'Pidgey', 'Charmeleon', 'Vulpix', 'Machop'],
  })
  actions.enterDuel('1v1')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('DuelBoardScreen — HUD', () => {
  it('renders the player and rival HUDs with active pokemon names and full HP', () => {
    renderDuelBoard(seed1v1Duel)
    const humanHud = screen.getByTestId('hud-human')
    const rivalHud = screen.getByTestId('hud-rival')
    expect(within(humanHud).getByText('PIKACHU')).toBeInTheDocument()
    expect(within(rivalHud).getByText('RATTATA')).toBeInTheDocument()
    expect(within(humanHud).getByText('100/100')).toBeInTheDocument()
    expect(within(rivalHud).getByText('100/100')).toBeInTheDocument()
  })

  it('shows the HP bars with the live HP value', () => {
    renderDuelBoard(seed1v1Duel)
    const bars = screen.getAllByRole('progressbar', { name: /hp/i })
    expect(bars).toHaveLength(2)
    for (const bar of bars) {
      expect(bar).toHaveAttribute('aria-valuenow', '100')
      expect(bar).toHaveAttribute('aria-valuemax', '100')
    }
  })
})

describe('DuelBoardScreen — move grid', () => {
  it('applies the fixed 25% damage to the rival when the strongest move is used', async () => {
    const user = userEvent.setup()
    renderDuelBoard(seed1v1Duel)
    await user.click(screen.getByRole('button', { name: /golpe fuerte/i }))
    const rivalHud = screen.getByTestId('hud-rival')
    expect(within(rivalHud).getByText('75/100')).toBeInTheDocument()
  })

  it('exposes all four moves with their damage labels', () => {
    renderDuelBoard(seed1v1Duel)
    expect(screen.getByRole('button', { name: /25% dmg/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /20% dmg/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /15% dmg/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /10% dmg/i })).toBeInTheDocument()
  })

  it('advances the turn number after an attack', async () => {
    const user = userEvent.setup()
    renderDuelBoard(seed1v1Duel)
    await user.click(screen.getByRole('button', { name: /golpe fuerte/i }))
    expect(screen.getByTestId('duel-probe').textContent).toContain('turn:2')
  })
})

describe('DuelBoardScreen — turn timer', () => {
  it('auto-applies the basic attack when the countdown expires without an action', () => {
    // Deterministic bot: force move 0 (25% damage) on the response.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.useFakeTimers()
    renderDuelBoard(seed1v1Duel)

    act(() => {
      vi.advanceTimersByTime(8000)
    })

    // Human basic attack (10%) → rival at 90; bot response (25%) → human at 75.
    const humanHud = screen.getByTestId('hud-human')
    const rivalHud = screen.getByTestId('hud-rival')
    expect(within(rivalHud).getByText('90/100')).toBeInTheDocument()
    expect(within(humanHud).getByText('75/100')).toBeInTheDocument()
    expect(screen.getByTestId('duel-probe').textContent).toContain('turn:2')
    // The RF-6.1 notice tells the player the timeout resolved as a basic attack.
    expect(screen.getByRole('status')).toHaveTextContent('SIN TIEMPO, ATAQUE BÁSICO')
  })

  it('restarts the countdown when a manual move resolves the turn', async () => {
    renderDuelBoard(seed1v1Duel)
    const ring = screen.getByTestId('timer-ring')
    expect(within(ring).getByText('08')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /golpe fuerte/i }))

    // The new turn re-arms the ring at the full timeout.
    expect(within(ring).getByText('08')).toBeInTheDocument()
    expect(screen.getByTestId('duel-probe').textContent).toContain('turn:2')
  })
})
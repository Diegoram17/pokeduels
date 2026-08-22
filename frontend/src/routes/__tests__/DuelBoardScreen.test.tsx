// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import type { MockStateActions } from '../../state/useMockState'
import { STORAGE_KEY, serializeMockState } from '../../state/store'
import type {
  DuelPokemonState,
  DuelState,
  MockState,
  TournamentSlot,
  TournamentState,
} from '../../state/schema'
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
  const [params] = useSearchParams()
  return (
    <span data-testid="swap-probe">
      mode:{params.get('mode') ?? 'none'}
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

function TournamentProbe() {
  const [state] = useMockState()
  const results = state.tournament?.results ?? {}
  return (
    <span data-testid="tournament-probe">
      activeSlot:{state.tournament?.activeSlot ?? 'none'}|slotsDone:{Object.keys(results).length}
    </span>
  )
}

function renderDuelBoard(seed?: (actions: MockStateActions) => void) {
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/duel']}>
        <SeedProbe seed={seed} />
        <DuelPhaseProbe />
        <TournamentProbe />
        <Routes>
          <Route
            path="/duel"
            element={
              <WaitForDuel>
                <DuelBoardScreen />
              </WaitForDuel>
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

// ---------------------------------------------------------------------------
// Pre-seeded state helpers (the provider hydrates from localStorage on mount)
// ---------------------------------------------------------------------------

function makePokemon(ownerId: string, pokemonId: string, isActive: boolean): DuelPokemonState {
  return {
    duelId: 'duel-slot',
    ownerId,
    pokemonId,
    name: pokemonId,
    type: 'normal',
    currentHp: isActive ? 100 : 0,
    ppMove1: 4,
    ppMove2: 4,
    ppMove3: 4,
    isActive,
    fainted: !isActive,
  }
}

const QUEUE_FULL: TournamentSlot[] = ['semiA', 'semiB', 'thirdPlace', 'final']

function makeTournamentState(overrides: Partial<TournamentState> = {}): TournamentState {
  return {
    bracket: {},
    queue: ['semiA', 'semiB'],
    activeSlot: 'semiA',
    results: {},
    ...overrides,
  }
}

function buildInProgressDuel(
  duelSlot: DuelState['slot'],
  tournament: TournamentState,
): MockState {
  return {
    player: { nickname: 'Ash' },
    room: {
      code: 'AB12',
      mode: 'tournament',
      maxPlayers: 4,
      status: 'in_progress',
      players: ['Ash'],
    },
    teamSelection: {
      starterId: 'Pikachu',
      rosterIds: ['Snorlax', 'Pidgey', 'Charmeleon', 'Vulpix', 'Machop'],
    },
    tournament,
    duelPokemonState: [
      makePokemon('Ash', 'Pikachu', true),
      makePokemon('bot', 'rattata', true),
    ],
    duel: {
      duelId: `duel-${duelSlot}`,
      slot: duelSlot,
      phase: 'awaiting_actions',
      turnNumber: 1,
      winnerId: null,
      endReason: null,
    },
  }
}

function renderDuelBoardFromState(state: MockState) {
  localStorage.setItem(STORAGE_KEY, serializeMockState(state))
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/duel']}>
        <DuelPhaseProbe />
        <TournamentProbe />
        <Routes>
          <Route
            path="/duel"
            element={
              <WaitForDuel>
                <DuelBoardScreen />
              </WaitForDuel>
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

describe('DuelBoardScreen — surrender', () => {
  it('opens a custom confirm dialog when the surrender button is clicked', async () => {
    const user = userEvent.setup()
    renderDuelBoard(seed1v1Duel)

    await user.click(screen.getByRole('button', { name: /rendirse/i }))

    const dialog = screen.getByRole('dialog', { name: /rendirse/i })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /rendirse/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /seguir luchando/i })).toBeInTheDocument()
  })

  it('closes the dialog and keeps the duel running when the player cancels', async () => {
    const user = userEvent.setup()
    renderDuelBoard(seed1v1Duel)

    await user.click(screen.getByRole('button', { name: /rendirse/i }))
    await user.click(screen.getByRole('button', { name: /seguir luchando/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('duel-probe').textContent).toContain('phase:awaiting_actions')
    expect(screen.getByTestId('duel-probe').textContent).toContain('winner:none')
  })

  it('ends the duel with the opponent as winner when the player confirms', async () => {
    const user = userEvent.setup()
    renderDuelBoard(seed1v1Duel)

    await user.click(screen.getByRole('button', { name: /rendirse/i }))
    const dialog = screen.getByRole('dialog', { name: /rendirse/i })
    await user.click(within(dialog).getByRole('button', { name: /rendirse/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('duel-probe').textContent).toContain('phase:finished')
    expect(screen.getByTestId('duel-probe').textContent).toContain('winner:bot')
  })
})

describe('DuelBoardScreen — swap navigation', () => {
  it('opens the swap screen in voluntary mode when the player clicks cambiar pokemon', async () => {
    const user = userEvent.setup()
    renderDuelBoard(seed1v1Duel)

    await user.click(screen.getByRole('button', { name: /cambiar pokémon/i }))

    expect(screen.getByText('SWAP-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('swap-probe').textContent).toContain('mode:voluntary')
    // The duel is untouched: still awaiting actions with the human active out.
    expect(screen.getByTestId('duel-probe').textContent).toContain('phase:awaiting_actions')
  })

  it('navigates to the swap screen in forced mode when the active pokemon faints', async () => {
    // Deterministic bot: move 0 (25% damage) on every response.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const user = userEvent.setup()
    renderDuelBoard(seed1v1Duel)

    // Four exchanges drop the human active to 0 HP; the KO forces the swap.
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole('button', { name: /ataque básico/i }))
    }

    expect(screen.getByText('SWAP-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('swap-probe').textContent).toContain('mode:forced')
    expect(screen.getByTestId('duel-probe').textContent).toContain('phase:awaiting_switch')
  })
})

describe('DuelBoardScreen — duel finish routing', () => {
  it('routes a finished 1v1 duel to the ranking screen', async () => {
    const user = userEvent.setup()
    renderDuelBoard(seed1v1Duel)

    await user.click(screen.getByRole('button', { name: /rendirse/i }))
    const dialog = screen.getByRole('dialog', { name: /rendirse/i })
    await user.click(within(dialog).getByRole('button', { name: /rendirse/i }))

    expect(screen.getByText('RANKING-LANDED')).toBeInTheDocument()
  })

  it('records the semifinal result and returns to the wait room while slots remain', async () => {
    const user = userEvent.setup()
    const state = buildInProgressDuel('semiA', makeTournamentState())
    renderDuelBoardFromState(state)

    await user.click(screen.getByRole('button', { name: /rendirse/i }))
    const dialog = screen.getByRole('dialog', { name: /rendirse/i })
    await user.click(within(dialog).getByRole('button', { name: /rendirse/i }))

    expect(screen.getByText('WAIT-LANDED')).toBeInTheDocument()
    // The recorded semiA result advances the wait room to the next slot.
    expect(screen.getByTestId('tournament-probe').textContent).toContain('activeSlot:semiB')
    expect(screen.getByTestId('tournament-probe').textContent).toContain('slotsDone:1')
  })

  it('routes to the ranking screen when the final concludes the tournament', async () => {
    const user = userEvent.setup()
    const state = buildInProgressDuel(
      'final',
      makeTournamentState({
        queue: QUEUE_FULL,
        activeSlot: 'final',
        results: {
          semiA: { winner: 'Ash', loser: 'bot' },
          semiB: { winner: 'Ash', loser: 'bot' },
          thirdPlace: { winner: 'bot', loser: 'Ash' },
        },
      }),
    )
    renderDuelBoardFromState(state)

    await user.click(screen.getByRole('button', { name: /rendirse/i }))
    const dialog = screen.getByRole('dialog', { name: /rendirse/i })
    await user.click(within(dialog).getByRole('button', { name: /rendirse/i }))

    expect(screen.getByText('RANKING-LANDED')).toBeInTheDocument()
    expect(screen.getByTestId('tournament-probe').textContent).toContain('slotsDone:4')
  })
})

describe('DuelBoardScreen — Rules of Hooks safety', () => {
  it('does not crash when duel flips from null to set while the screen stays mounted', async () => {
    // Seeds only room + teamSelection (no duel yet) so the FIRST render hits
    // the `!duel` branch. The screen is mounted directly (no Route/Navigate
    // gate) so the instance survives the null -> set transition in place —
    // this is exactly the scenario a Rules-of-Hooks violation crashes on.
    localStorage.setItem(
      STORAGE_KEY,
      serializeMockState({
        player: { nickname: 'Ash' },
        room: { code: 'AB12', mode: '1v1', maxPlayers: 2, status: 'waiting', players: ['Ash'] },
        teamSelection: {
          starterId: 'Pikachu',
          rosterIds: ['Snorlax', 'Pidgey', 'Charmeleon', 'Vulpix', 'Machop'],
        },
        tournament: null,
        duelPokemonState: [],
        duel: null,
      }),
    )

    function EnterDuelTrigger() {
      const [, actions] = useMockState()
      return (
        <button type="button" onClick={() => actions.enterDuel('1v1')}>
          start-duel
        </button>
      )
    }

    render(
      <MockStateProvider>
        <MemoryRouter initialEntries={['/duel']}>
          <EnterDuelTrigger />
          <DuelBoardScreen />
        </MemoryRouter>
      </MockStateProvider>,
    )

    const user = userEvent.setup()
    // First render: duel is null. Click sets duel on the SAME instance —
    // a hook-order mismatch throws here on the buggy implementation.
    await user.click(screen.getByRole('button', { name: 'start-duel' }))

    expect(screen.getByTestId('hud-human')).toBeInTheDocument()
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
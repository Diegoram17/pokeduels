// @vitest-environment jsdom
// #10 PR 2 integration tests for DuelBoardScreen: WS-driven lead selection,
// presentation-only timer, opponent-disconnect banner, insufficient-PP
// handling, and the new server-driven finish routing (1v1 -> wait-room rematch,
// bracket+finalRanking -> ranking, bracket+noFinalRanking -> wait/go-now).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import { STORAGE_KEY, serializeMockState } from '../../state/store'
import { setCachedCatalog } from '../../lib/catalog'
import type { Pokemon } from '../../lib/catalog'
import type { MockState } from '../../state/schema'
import type { DuelSnapshot } from '../../state/store'
import DuelBoardScreen from '../DuelBoardScreen'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { disconnectSocket } from '../../lib/socket'

const wsCatalog: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'front-pikachu', back_sprite_url: 'back-pikachu', is_starter: true },
  { id: 5, name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'front-snorlax', back_sprite_url: 'back-snorlax', is_starter: false },
  { id: 6, name: 'Eevee', type: 'normal', pokeapi_id: 133, sprite_url: 'front-eevee', back_sprite_url: 'back-eevee', is_starter: false },
  { id: 23, name: 'Pidgeot', type: 'flying', pokeapi_id: 18, sprite_url: 'front-pidgeot', back_sprite_url: 'back-pidgeot', is_starter: false },
]

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

// Human roster: 25 Pikachu, 5 Snorlax, 6 Eevee (ownerId 10). Rival: 23 Pidgeot
// (ownerId 11). The snapshot has NO phase field — lead_selection is derived
// from the absence of any active pokemon (backend contract).
function leadSelectionSnapshot(): DuelSnapshot {
  return {
    duelId: 42,
    turnNumber: 1,
    winnerId: null,
    endReason: null,
    pokemonStates: [
      { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
      { duelId: 42, ownerId: 10, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
      { duelId: 42, ownerId: 10, pokemonId: 6, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
      { duelId: 42, ownerId: 11, pokemonId: 23, type: 'flying', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
    ],
  }
}

function liveTurnSnapshot(overrides: Partial<DuelSnapshot> = {}): DuelSnapshot {
  return {
    duelId: 42,
    turnNumber: 2,
    winnerId: null,
    endReason: null,
    pokemonStates: [
      { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 75, ppMove1: 3, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
      { duelId: 42, ownerId: 10, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
      { duelId: 42, ownerId: 10, pokemonId: 6, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
      { duelId: 42, ownerId: 11, pokemonId: 23, type: 'flying', currentHp: 75, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
    ],
    ...overrides,
  }
}

function seedSession(maxPlayers: 2 | 4) {
  const state: MockState = {
    player: { nickname: 'Ash', playerId: '10', sessionToken: 'token-1' },
    room: {
      code: 'AB12',
      maxPlayers,
      status: 'in_progress',
      players: [
        { playerId: '10', nickname: 'Ash', ready: true, connected: true },
        { playerId: '11', nickname: 'Misty', ready: true, connected: true },
      ],
    },
    teamSelection: { starterId: 25, rosterIds: [5, 6, 23] },
    tournament: null,
    duelPokemonState: [],
    duel: null,
    pendingDuelId: null,
    finalRanking: null,
    roomAborted: null,
  }
  localStorage.setItem(STORAGE_KEY, serializeMockState(state))
}

/**
 * A MockState whose duel is ALREADY in progress — exactly what localStorage
 * holds after a page refresh mid-duel. Used to prove DuelBoardScreen re-emits
 * duel:join on mount (and on remount) so the server resyncs duel:state (spec:
 * Mid-Duel Reconnection).
 */
function liveDuelState(duelId: number): MockState {
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
      { duelId: String(duelId), ownerId: 10, pokemonId: 25, name: 'Pikachu', type: 'electric', spriteUrl: 'front-pikachu', backSpriteUrl: 'back-pikachu', currentHp: 75, ppMove1: 3, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
      { duelId: String(duelId), ownerId: 11, pokemonId: 23, name: 'Pidgeot', type: 'flying', spriteUrl: 'front-pidgeot', backSpriteUrl: 'back-pidgeot', currentHp: 75, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
    ],
    duel: {
      duelId: String(duelId),
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
    roomAborted: null,
  }
}

function DuelProbe() {
  const [state] = useMockState()
  return (
    <span data-testid="duel-probe">
      phase:{state.duel?.phase ?? 'none'}|turn:{state.duel?.turnNumber ?? 'none'}
      |winner:{state.duel?.winnerId ?? 'none'}
    </span>
  )
}

function WaitForDuel({ children }: { children: ReactNode }) {
  const [state] = useMockState()
  if (!state.duel) return <div>setting-up-duel</div>
  return <>{children}</>
}

function renderBoard(maxPlayers: 2 | 4 = 2, seed?: MockState) {
  if (seed) {
    localStorage.setItem(STORAGE_KEY, serializeMockState(seed))
  } else {
    seedSession(maxPlayers)
  }
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/duel']}>
        <DuelProbe />
        <Routes>
          <Route
            path="/duel"
            element={
              <WaitForDuel>
                <DuelBoardScreen />
              </WaitForDuel>
            }
          />
          <Route path="/swap" element={<div>SWAP-LANDED</div>} />
          <Route path="/wait-room" element={<div>WAIT-ROOM-LANDED</div>} />
          <Route path="/ranking" element={<div>RANKING-LANDED</div>} />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

/** Fires duel:start + a lead_selection snapshot so the board mounts with the picker. */
function startLeadSelection() {
  act(() => {
    fakeSocket._fire('duel:start', { duelId: 42 })
    fakeSocket._fire('duel:state', leadSelectionSnapshot())
  })
}

/**
 * The server broadcast emitted once BOTH leads are ready (duelHandlers now
 * emits duel:state after markDuelInProgress): both sides field an active
 * pokemon, so the client derives phase 'awaiting_actions'.
 */
function leadsSettledSnapshot(activePokemonId: number = 25): DuelSnapshot {
  return {
    duelId: 42,
    turnNumber: 1,
    winnerId: null,
    endReason: null,
    pokemonStates: [
      { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: activePokemonId === 25, fainted: false },
      { duelId: 42, ownerId: 10, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: activePokemonId === 5, fainted: false },
      { duelId: 42, ownerId: 10, pokemonId: 6, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: activePokemonId === 6, fainted: false },
      { duelId: 42, ownerId: 11, pokemonId: 23, type: 'flying', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
    ],
  }
}

/**
 * Lead-selection snapshot + optimistic pick (Pikachu) + the server's
 * leads-settled broadcast -> round 1 awaiting_actions.
 */
function startRound1() {
  startLeadSelection()
  act(() => {
    screen.getByRole('button', { name: /pikachu/i }).click()
  })
  act(() => {
    fakeSocket._fire('duel:state', leadsSettledSnapshot())
  })
}

beforeEach(() => {
  fakeSocket = makeFakeSocket()
  vi.mocked(io).mockReturnValue(fakeSocket as never)
  setCachedCatalog(wsCatalog)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  setCachedCatalog(null)
  disconnectSocket()
})

describe('DuelBoardScreen — lead selection', () => {
  it('renders the lead picker from a lead_selection snapshot and submits the pick via WS', () => {
    renderBoard(2)
    startLeadSelection()

    expect(screen.getByText('ELIGE TU PRIMER POKÉMON')).toBeInTheDocument()
    const options = screen.getAllByRole('button', { name: /pikachu|snorlax|eevee/i })
    expect(options).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /pidgeot/i })).not.toBeInTheDocument()

    act(() => {
      screen.getByRole('button', { name: /snorlax/i }).click()
    })

    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:select_lead', {
      duelId: 42,
      pokemonId: 5,
    })
    // The optimistic echo activates the pick locally but the phase stays
    // lead_selection — the picker remains until the server broadcasts
    // duel:state confirming both leads (which advances the phase).
    expect(screen.getByText('ELIGE TU PRIMER POKÉMON')).toBeInTheDocument()
    act(() => {
      fakeSocket._fire('duel:state', leadsSettledSnapshot(5))
    })
    expect(screen.queryByText('ELIGE TU PRIMER POKÉMON')).not.toBeInTheDocument()
    expect(screen.getByTestId('duel-probe').textContent).toContain('phase:awaiting_actions')
  })

  it('renders each lead option as a full card: pokemon sprite + ELEGIR affordance', () => {
    renderBoard(2)
    startLeadSelection()

    const picker = screen.getByTestId('lead-picker')
    const pikachuOption = within(picker).getByRole('button', { name: /pikachu/i })

    const sprite = pikachuOption.querySelector('img')
    expect(sprite).toHaveAttribute('src', 'front-pikachu')
    expect(within(pikachuOption).getByText('ELEGIR')).toBeInTheDocument()

    act(() => {
      pikachuOption.click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:select_lead', {
      duelId: 42,
      pokemonId: 25,
    })
  })
})

describe('DuelBoardScreen — post-round KO (opponent switching)', () => {
  // Rival active KO'd + rival has a live bench -> phase derives to
  // awaiting_switch. The HUMAN still has a live active, so they are NOT forced
  // onto /swap: a keep-or-change modal appears instead.
  function fireOpponentKoSnapshot() {
    act(() => {
      fakeSocket._fire('duel:turn_resolved', {
        duelId: 42,
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        pokemonStates: [
          { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 60, ppMove1: 3, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
          { duelId: 42, ownerId: 11, pokemonId: 23, type: 'flying', currentHp: 0, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: true },
          { duelId: 42, ownerId: 11, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
        ],
      })
    })
  }

  it('shows the keep-or-change modal (no /swap redirect) when the human still has an active', () => {
    renderBoard(2)
    startRound1()
    fireOpponentKoSnapshot()

    expect(screen.getByTestId('post-round-switch')).toBeInTheDocument()
    expect(screen.getByText('¡GANASTE ESTE VERSUS!')).toBeInTheDocument()
    expect(screen.queryByText('SWAP-LANDED')).not.toBeInTheDocument()

    act(() => {
      screen.getByRole('button', { name: /continuar/i }).click()
    })
    expect(screen.queryByTestId('post-round-switch')).not.toBeInTheDocument()
    expect(screen.queryByText('SWAP-LANDED')).not.toBeInTheDocument()
  })

  it('keeps a rival placeholder (not a blank arena) while the opponent picks a replacement, then restores it', () => {
    renderBoard(2)
    startRound1()
    fireOpponentKoSnapshot()

    act(() => {
      screen.getByRole('button', { name: /continuar/i }).click()
    })

    // The opponent has no active — the rival slot shows a "choosing" placeholder.
    expect(screen.getByTestId('rival-choosing')).toBeInTheDocument()
    expect(screen.getByText(/rival está eligiendo/i)).toBeInTheDocument()

    // The opponent's new active arrives -> placeholder gone, board resumes.
    act(() => {
      fakeSocket._fire('duel:state', {
        duelId: 42,
        turnNumber: 2,
        winnerId: null,
        endReason: null,
        pokemonStates: [
          { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 60, ppMove1: 3, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
          { duelId: 42, ownerId: 11, pokemonId: 23, type: 'flying', currentHp: 0, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: true },
          { duelId: 42, ownerId: 11, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
        ],
      })
    })
    expect(screen.queryByTestId('rival-choosing')).not.toBeInTheDocument()
    expect(screen.getByTestId('duel-probe').textContent).toContain('phase:awaiting_actions')
  })

  it('CAMBIAR POKÉMON from the modal goes to voluntary swap', () => {
    renderBoard(2)
    startRound1()
    fireOpponentKoSnapshot()

    const modal = screen.getByTestId('post-round-switch')
    act(() => {
      within(modal).getByRole('button', { name: /cambiar pokémon/i }).click()
    })
    // The modal routed to the swap screen (voluntary mode — see onChange).
    expect(screen.getByText('SWAP-LANDED')).toBeInTheDocument()
    expect(screen.queryByTestId('post-round-switch')).not.toBeInTheDocument()
  })
})

describe('DuelBoardScreen — post-victory lead modal (bracket rounds)', () => {
  function nextRoundLeadSnapshot(): DuelSnapshot {
    return {
      duelId: 77,
      turnNumber: 1,
      winnerId: null,
      endReason: null,
      pokemonStates: [
        { duelId: 77, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
        { duelId: 77, ownerId: 10, pokemonId: 5, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
        { duelId: 77, ownerId: 10, pokemonId: 6, type: 'normal', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
        { duelId: 77, ownerId: 12, pokemonId: 23, type: 'flying', currentHp: 100, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: false, fainted: false },
      ],
    }
  }

  function winSemifinalWithPikachu() {
    renderBoard(4)
    startLeadSelection()
    act(() => {
      fakeSocket._fire('tournament:bracket', {
        roomId: 1,
        bracket: { semiA: { duelId: 42, playerA: 10, playerB: 11 } },
      })
    })
    act(() => {
      screen.getByRole('button', { name: /pikachu/i }).click()
    })
    act(() => {
      fakeSocket._fire('duel:state', leadsSettledSnapshot(25))
    })
    act(() => {
      fakeSocket._fire('duel:finished', { duelId: 42, winnerId: 10, endReason: 'ko' })
    })
  }

  it('offers CONTINUAR / CAMBIAR POKEMON before the next round picker after a bracket win', () => {
    winSemifinalWithPikachu()
    act(() => {
      fakeSocket._fire('duel:state', nextRoundLeadSnapshot())
    })

    expect(screen.getByText('¡GANASTE ESTE VERSUS!')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continuar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cambiar pokémon/i })).toBeInTheDocument()
  })

  it('CONTINUAR auto-submits the winning pokemon as the next lead', () => {
    winSemifinalWithPikachu()
    act(() => {
      fakeSocket._fire('duel:state', nextRoundLeadSnapshot())
    })

    act(() => {
      screen.getByRole('button', { name: /continuar/i }).click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:select_lead', { duelId: 77, pokemonId: 25 })
    expect(screen.queryByText('¡GANASTE ESTE VERSUS!')).not.toBeInTheDocument()
  })

  it('CAMBIAR POKEMON drops the modal to the normal picker without auto-selecting', () => {
    winSemifinalWithPikachu()
    act(() => {
      fakeSocket._fire('duel:state', nextRoundLeadSnapshot())
    })

    act(() => {
      screen.getByRole('button', { name: /cambiar pokémon/i }).click()
    })
    expect(screen.queryByText('¡GANASTE ESTE VERSUS!')).not.toBeInTheDocument()
    expect(screen.getByTestId('lead-picker')).toBeInTheDocument()
    // No auto-pick for the new round — only the semifinal's own select_lead ran.
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('duel:select_lead', { duelId: 77, pokemonId: 25 })
  })
})

describe('DuelBoardScreen — move submission', () => {
  it('enables the move grid in round 1 before the rival lead is known and emits the 1-based move', () => {
    renderBoard(2)
    startRound1()

    // The grid must not be gated on the rival lead — it renders once the human
    // active is set (the server's leads-settled broadcast already fields it).
    const grid = screen.getByRole('button', { name: /golpe fuerte/i })
    expect(grid).toBeEnabled()

    act(() => {
      screen.getByRole('button', { name: /golpe fuerte/i }).click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:select_action', {
      duelId: 42,
      moveIndex: 1,
    })
  })

  it('disables a move with 0 PP while keeping the infinite basic attack enabled', () => {
    renderBoard(2)
    startLeadSelection()
    act(() => {
      fakeSocket._fire('duel:turn_resolved', {
        ...liveTurnSnapshot(),
        pokemonStates: [
          { duelId: 42, ownerId: 10, pokemonId: 25, type: 'electric', currentHp: 75, ppMove1: 0, ppMove2: 0, ppMove3: 4, isActive: true, fainted: false },
          { duelId: 42, ownerId: 11, pokemonId: 23, type: 'flying', currentHp: 75, ppMove1: 4, ppMove2: 4, ppMove3: 4, isActive: true, fainted: false },
        ],
      })
    })

    expect(screen.getByRole('button', { name: /golpe fuerte/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /ataque veloz/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /golpe rápido/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /ataque básico/i })).toBeEnabled()
  })

  it('shows the rejection notice on duel:action_rejected without advancing the turn or resetting the ring', () => {
    vi.useFakeTimers()
    renderBoard(2)
    startRound1()

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    const ring = screen.getByTestId('timer-ring')
    // 10s turn window (TURN_TIMEOUT_SECONDS) minus 2s elapsed.
    expect(within(ring).getByText('08')).toBeInTheDocument()

    act(() => {
      fakeSocket._fire('duel:action_rejected', { moveIndex: 1, reason: 'insufficient_pp' })
    })

    expect(screen.getByRole('status')).toHaveTextContent(/rechazado/i)
    expect(screen.getByTestId('duel-probe').textContent).toContain('turn:1')
    // The ring keeps counting from where it was — the rejection must not reset it.
    expect(within(ring).getByText('08')).toBeInTheDocument()
    expect(fakeSocket.emit).not.toHaveBeenCalledWith(
      'duel:select_action',
      expect.anything(),
    )
  })
})

describe('DuelBoardScreen — presentation-only timer', () => {
  it('never auto-submits an action when the countdown expires', () => {
    vi.useFakeTimers()
    renderBoard(2)
    startRound1()

    act(() => {
      // Past the full 10s turn window — the cosmetic countdown expiring must
      // still never trigger a client-side auto-submit.
      vi.advanceTimersByTime(12000)
    })

    expect(fakeSocket.emit).not.toHaveBeenCalledWith(
      'duel:select_action',
      expect.anything(),
    )
    expect(screen.getByTestId('duel-probe').textContent).toContain('turn:1')
  })
})

describe('DuelBoardScreen — opponent disconnect banner', () => {
  it('shows a non-blocking banner on duel:opponent_disconnected and keeps the UI interactive', () => {
    renderBoard(2)
    startRound1()

    act(() => {
      fakeSocket._fire('duel:opponent_disconnected', { duelId: 42 })
    })

    expect(screen.getByRole('status')).toHaveTextContent(/rival se desconect/i)
    // Non-blocking: the move grid stays usable.
    expect(screen.getByRole('button', { name: /golpe fuerte/i })).toBeEnabled()

    act(() => {
      screen.getByRole('button', { name: /golpe fuerte/i }).click()
    })
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:select_action', {
      duelId: 42,
      moveIndex: 1,
    })
  })

  it('clears the banner on the next duel:turn_resolved', () => {
    renderBoard(2)
    startRound1()

    act(() => {
      fakeSocket._fire('duel:opponent_disconnected', { duelId: 42 })
    })
    expect(screen.getByRole('status')).toHaveTextContent(/rival se desconect/i)

    act(() => {
      fakeSocket._fire('duel:turn_resolved', liveTurnSnapshot())
    })

    expect(screen.queryByText(/rival se desconect/i)).not.toBeInTheDocument()
  })
})

describe('DuelBoardScreen — finish routing (server-driven)', () => {
  it('routes a finished 1v1 duel to the wait room (rematch panel)', () => {
    renderBoard(2)
    startLeadSelection()
    act(() => {
      fakeSocket._fire('duel:finished', { duelId: 42, winnerId: 10, endReason: 'ko' })
    })

    expect(screen.getByText('WAIT-ROOM-LANDED')).toBeInTheDocument()
  })

  it('routes a finished bracket duel to the ranking screen once the final ranking is in', () => {
    renderBoard(4)
    startLeadSelection()
    act(() => {
      fakeSocket._fire('tournament:bracket', {
        roomId: 1,
        bracket: { semiA: { duelId: 42, playerA: 10, playerB: 11 } },
      })
      fakeSocket._fire('room:final_ranking', {
        roomId: 1,
        ranking: [
          { playerId: 10, nickname: 'Ash', finalRank: 1 },
          { playerId: 11, nickname: 'Misty', finalRank: 2 },
        ],
      })
      fakeSocket._fire('duel:finished', { duelId: 42, winnerId: 10, endReason: 'ko' })
    })

    expect(screen.getByText('RANKING-LANDED')).toBeInTheDocument()
  })

  it('renders the wait/go-now choice after a bracket duel while the room is open, and "IR YA" goes to the ranking screen', () => {
    renderBoard(4)
    startLeadSelection()
    act(() => {
      fakeSocket._fire('tournament:bracket', {
        roomId: 1,
        bracket: { semiA: { duelId: 42, playerA: 10, playerB: 11 } },
      })
      fakeSocket._fire('duel:finished', { duelId: 42, winnerId: 10, endReason: 'ko' })
    })

    expect(screen.getByRole('button', { name: /esperar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ir ya/i })).toBeInTheDocument()
    expect(screen.queryByText('WAIT-ROOM-LANDED')).not.toBeInTheDocument()
    expect(screen.queryByText('RANKING-LANDED')).not.toBeInTheDocument()

    act(() => {
      screen.getByRole('button', { name: /ir ya/i }).click()
    })
    expect(screen.getByText('RANKING-LANDED')).toBeInTheDocument()
  })

  it('auto-navigates to the ranking screen when room:final_ranking arrives while the player waits', async () => {
    renderBoard(4)
    startLeadSelection()
    act(() => {
      fakeSocket._fire('tournament:bracket', {
        roomId: 1,
        bracket: { semiA: { duelId: 42, playerA: 10, playerB: 11 } },
      })
      fakeSocket._fire('duel:finished', { duelId: 42, winnerId: 10, endReason: 'ko' })
    })
    expect(screen.getByRole('button', { name: /esperar/i })).toBeInTheDocument()

    // Choosing "esperar" keeps the waiting view (no navigation).
    act(() => {
      screen.getByRole('button', { name: /esperar/i }).click()
    })
    expect(screen.queryByText('RANKING-LANDED')).not.toBeInTheDocument()
    expect(screen.queryByText('WAIT-ROOM-LANDED')).not.toBeInTheDocument()

    act(() => {
      fakeSocket._fire('room:final_ranking', {
        roomId: 1,
        ranking: [
          { playerId: 10, nickname: 'Ash', finalRank: 1 },
          { playerId: 11, nickname: 'Misty', finalRank: 2 },
        ],
      })
    })

    await waitFor(() => {
      expect(screen.getByText('RANKING-LANDED')).toBeInTheDocument()
    })
  })
})

describe('DuelBoardScreen — lead-selection countdown (cosmetic)', () => {
  it('shows a visible countdown during lead selection and ticks it down', () => {
    vi.useFakeTimers()
    renderBoard(2)
    startLeadSelection()

    const countdown = screen.getByTestId('lead-countdown')
    expect(countdown.textContent).toBe('30')

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(countdown.textContent).toBe('27')
  })

  it('lets the countdown expire without auto-submitting a lead — the pick stays available', () => {
    vi.useFakeTimers()
    renderBoard(2)
    startLeadSelection()

    act(() => {
      vi.advanceTimersByTime(31000)
    })

    expect(fakeSocket.emit).not.toHaveBeenCalledWith('duel:select_lead', expect.anything())
    expect(screen.getByText('ELIGE TU PRIMER POKÉMON')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pikachu/i })).toBeEnabled()
  })
})

describe('DuelBoardScreen — mid-duel reconnection (duel:join re-emit)', () => {
  it('re-emits duel:join on mount so an already-in-progress duel resyncs duel:state from the server', () => {
    renderBoard(2, liveDuelState(42))

    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:join', { duelId: 42 })
    // The resynced board renders the live phase, not a fresh lead picker.
    expect(screen.getByTestId('duel-probe').textContent).toContain('phase:awaiting_actions')
  })

  it('re-emits duel:join on remount (fresh instance) against the current local duel', () => {
    const first = renderBoard(2, liveDuelState(42))
    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:join', { duelId: 42 })

    first.unmount()

    // Between mounts the local duel is replaced (e.g. a rematch bootstrapped
    // while the player was away): the remount must resync against the duel the
    // client now has — never reuse context from the previous mount.
    renderBoard(2, liveDuelState(99))

    expect(fakeSocket.emit).toHaveBeenCalledWith('duel:join', { duelId: 99 })
    const emitMock = fakeSocket.emit as unknown as ReturnType<typeof vi.fn>
    const joinCalls = emitMock.mock.calls.filter((call: unknown[]) => call[0] === 'duel:join')
    expect(joinCalls).toHaveLength(2)
  })

  it('does not re-emit duel:join for a finished duel (finish routing owns that state)', () => {
    const live = liveDuelState(42)
    renderBoard(2, {
      ...live,
      duel: { ...live.duel!, phase: 'finished', winnerId: '10', endReason: 'ko' },
    })

    expect(fakeSocket.emit).not.toHaveBeenCalledWith('duel:join', expect.anything())
  })
})
// @vitest-environment jsdom
// Fase 7 (PR8): the useAttackReplay hook walks the server-authoritative
// attackSequence on each new resolved turn, toggling the CSS-keyframe classes
// (pd-lunge--human / pd-lunge--rival on the attacker sprite, pd-shake on the
// defender) and exposing a `replaying` lock. The resync guard makes a
// duelStateReceived with the same turnNumber a no-op.

import { describe, it, expect, vi } from 'vitest'
import { useRef } from 'react'
import { act, render, fireEvent } from '@testing-library/react'
import { useAttackReplay } from '../useAttackReplay'
import type { AttackEvent, DuelState } from '../../schema'

function makeDuel(turnNumber: number, attackSequence: AttackEvent[] | null): DuelState {
  return {
    duelId: '42',
    slot: '1v1',
    phase: 'awaiting_actions',
    turnNumber,
    winnerId: null,
    endReason: null,
    opponentDisconnected: false,
    lastRejection: null,
    attackSequence,
  }
}

const twoEvents: AttackEvent[] = [
  // Rival (playerId 11) strikes first, then the human (playerId 10).
  { type: 'resolved', playerId: 11, moveIndex: 2, damage: 25, effectiveness: 1, fainted: false },
  { type: 'resolved', playerId: 10, moveIndex: 4, damage: 10, effectiveness: 1, fainted: true },
]

function ReplayHarness({ duel, playerId }: { duel: DuelState | null; playerId: string | null }) {
  const humanRef = useRef<HTMLImageElement>(null)
  const rivalRef = useRef<HTMLImageElement>(null)
  const { replaying } = useAttackReplay(duel, playerId, humanRef, rivalRef)
  return (
    <div>
      <img ref={humanRef} data-testid="human-sprite" alt="human" src="back-pikachu" />
      <img ref={rivalRef} data-testid="rival-sprite" alt="rival" src="front-snorlax" />
      <button type="button" disabled={replaying}>
        MOVERSE
      </button>
    </div>
  )
}

describe('useAttackReplay', () => {
  it('walks a 2-event resolved sequence, toggling lunge/shake on the right sprites and locking controls until done', () => {
    // Mount with no duel (lastPlayedTurn = 0), then a turn-2 resolution with a
    // sequence arrives — the replay kicks off.
    const { rerender, getByTestId, getByRole } = render(
      <ReplayHarness duel={null} playerId="10" />,
    )
    const humanSprite = getByTestId('human-sprite')
    const rivalSprite = getByTestId('rival-sprite')
    const moveBtn = getByRole('button', { name: /movers/i })

    rerender(<ReplayHarness duel={makeDuel(2, twoEvents)} playerId="10" />)

    // Step 1: the rival (11) attacks — rival lunges, human shakes, controls lock.
    expect(rivalSprite.classList.contains('pd-lunge--rival')).toBe(true)
    expect(humanSprite.classList.contains('pd-shake')).toBe(true)
    expect(humanSprite.classList.contains('pd-lunge--human')).toBe(false)
    expect(moveBtn).toBeDisabled()

    // animationend on the attacker advances to step 2.
    fireEvent.animationEnd(rivalSprite)
    expect(rivalSprite.classList.contains('pd-lunge--rival')).toBe(false)
    expect(humanSprite.classList.contains('pd-shake')).toBe(false)

    // Step 2: the human (10) attacks — human lunges, rival shakes.
    expect(humanSprite.classList.contains('pd-lunge--human')).toBe(true)
    expect(rivalSprite.classList.contains('pd-shake')).toBe(true)

    fireEvent.animationEnd(humanSprite)

    // Sequence complete — classes cleared, controls released.
    expect(humanSprite.classList.contains('pd-lunge--human')).toBe(false)
    expect(rivalSprite.classList.contains('pd-shake')).toBe(false)
    expect(moveBtn).toBeEnabled()
  })

  it('does not replay on a resync with the same turnNumber (mount guard + duelStateReceived)', () => {
    // Mount directly at turn 2 WITH a sequence — the mount guard treats the
    // current turn as already played (a fresh mount must not replay old turns).
    const { rerender, getByTestId, getByRole } = render(
      <ReplayHarness duel={makeDuel(2, twoEvents)} playerId="10" />,
    )
    const humanSprite = getByTestId('human-sprite')
    const rivalSprite = getByTestId('rival-sprite')
    const moveBtn = getByRole('button', { name: /movers/i })

    expect(rivalSprite.classList.contains('pd-lunge--rival')).toBe(false)
    expect(humanSprite.classList.contains('pd-shake')).toBe(false)
    expect(moveBtn).toBeEnabled()

    // duelStateReceived resync: same turnNumber, attackSequence null → nothing.
    rerender(<ReplayHarness duel={makeDuel(2, null)} playerId="10" />)
    expect(rivalSprite.classList.contains('pd-lunge--rival')).toBe(false)
    expect(humanSprite.classList.contains('pd-shake')).toBe(false)
    expect(moveBtn).toBeEnabled()

    // Even a same-turn sequence arriving later (e.g. StrictMode double-fire)
    // must not replay — the turn was already marked as played.
    rerender(<ReplayHarness duel={makeDuel(2, twoEvents)} playerId="10" />)
    expect(rivalSprite.classList.contains('pd-lunge--rival')).toBe(false)
    expect(humanSprite.classList.contains('pd-shake')).toBe(false)
    expect(moveBtn).toBeEnabled()
  })

  it('releases the control lock after a hard ceiling even if animationend never fires (QA-round-2 freeze guard)', () => {
    vi.useFakeTimers()
    try {
      const { rerender, getByRole } = render(
        <ReplayHarness duel={null} playerId="10" />,
      )
      const moveBtn = getByRole('button', { name: /movers/i })

      // A new turn with a sequence starts the replay and locks controls.
      act(() => {
        rerender(<ReplayHarness duel={makeDuel(2, twoEvents)} playerId="10" />)
      })
      expect(moveBtn).toBeDisabled()

      // jsdom never fires `animationend`, so without the guard the lock sticks
      // forever. Advancing past the ceiling must release it.
      act(() => {
        vi.advanceTimersByTime(8100)
      })
      expect(moveBtn).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})
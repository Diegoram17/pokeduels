import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { AttackEvent, DuelState } from '../schema'

/**
 * Fase 7 (PR8): CSS-keyframe attack replay over the server-authoritative
 * `attackSequence` (forwarded from `duel:turn_resolved.turnEvents`).
 *
 * On a NEW turn (`duel.turnNumber` changed) that carries a non-empty sequence,
 * walks the events in server order: each `resolved` event adds
 * `pd-lunge--human`/`pd-lunge--rival` to the ATTACKER's arena sprite and
 * `pd-shake` to the DEFENDER's, then advances on the attacker's `animationend`
 * (the ~3–4 s/turn overlap between the two strikes lives entirely in keyframe
 * timing). `skipped`/`rejected` events are stepped over — that is the wasKO
 * handling: the KO'd side's follow-up strike was already skipped by the
 * engine. Exposes `replaying` so the screen can lock the move grid + swap.
 *
 * Resync guard: a fresh mount marks the current turn as already played
 * (`lastPlayedTurn.current = duel.turnNumber`), and replays only when
 * `attackSequence != null AND turnNumber !== lastPlayedTurn.current` — so
 * `duel:state` (mid-duel refresh) and StrictMode double-fire never replay.
 * Under `prefers-reduced-motion` the Phase-5 blanket collapses the keyframes,
 * every `animationend` fires ~immediately and the sequence self-completes
 * (no JS matchMedia).
 */
export function useAttackReplay(
  duel: DuelState | null,
  playerId: string | null,
  humanSpriteRef: RefObject<HTMLImageElement | null>,
  rivalSpriteRef: RefObject<HTMLImageElement | null>,
): { replaying: boolean } {
  const [replaying, setReplaying] = useState(false)
  const lastPlayedTurn = useRef(duel?.turnNumber ?? 0)
  const stepRef = useRef(0)
  const seqRef = useRef<AttackEvent[] | null>(null)
  const humanIdRef = useRef(Number(playerId))

  // Resync guard (mount-scoped): a fresh mount must not replay the current
  // turn's events — they already played before the remount (mid-duel refresh).
  useEffect(() => {
    lastPlayedTurn.current = duel?.turnNumber ?? 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const playStep = useCallback(() => {
    const sequence = seqRef.current
    const humanEl = humanSpriteRef.current
    const rivalEl = rivalSpriteRef.current

    if (!sequence || stepRef.current >= sequence.length) {
      setReplaying(false)
      return
    }
    const event = sequence[stepRef.current]

    // Guard null refs: if a snapshot removed a fainted active mid-sequence,
    // consume the rest without animating and release the control lock.
    const attackerEl = event.playerId === humanIdRef.current ? humanEl : rivalEl
    const defenderEl = event.playerId === humanIdRef.current ? rivalEl : humanEl
    if (!attackerEl || !defenderEl) {
      setReplaying(false)
      return
    }

    // skipped/rejected events animate nothing — step over them.
    if (event.type !== 'resolved') {
      stepRef.current += 1
      playStep()
      return
    }

    const attackerClass =
      event.playerId === humanIdRef.current ? 'pd-lunge--human' : 'pd-lunge--rival'
    attackerEl.classList.add(attackerClass)
    defenderEl.classList.add('pd-shake')

    const finishStep = () => {
      attackerEl.classList.remove(attackerClass)
      defenderEl.classList.remove('pd-shake')
      stepRef.current += 1
      playStep()
    }
    attackerEl.addEventListener('animationend', finishStep, { once: true })
  }, [humanSpriteRef, rivalSpriteRef])

  // Kick off the replay when a NEW turn arrives carrying a sequence.
  useEffect(() => {
    const sequence = duel?.attackSequence ?? null
    if (!duel || !sequence || sequence.length === 0) return
    if (duel.turnNumber === lastPlayedTurn.current) return
    lastPlayedTurn.current = duel.turnNumber
    seqRef.current = sequence
    humanIdRef.current = Number(playerId)
    stepRef.current = 0
    setReplaying(true)
    playStep()
  }, [duel, playerId, playStep])

  return { replaying }
}
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import type { DuelPokemonState } from '../state/schema'
import type { MoveIndex } from '../lib/moveIndex'
import Modal from '../components/Modal'
import ScreenTopbar from '../components/ScreenTopbar'
import { HudCard } from '../components/PokemonCard'
import { humanActivePokemon, rivalActivePokemon, computePostDuelRoute } from '../lib/duelFlow'
import { useAttackReplay } from '../state/hooks/useAttackReplay'
import {
  BASIC_ATTACK_INDEX,
  LEAD_SELECTION_TIMEOUT_SECONDS,
  MOVE_SLOTS,
  TURN_TIMEOUT_SECONDS,
  isBasicAttack,
  moveDamageLabel,
} from '../lib/duelBoard'

/**
 * Screen 5: Duel Board (#10 PR 2). Server-authoritative gameplay: lead
 * selection submits via WS, moves/switch/surrender emit WS actions, and every
 * outcome renders from server-pushed state. The countdown is cosmetic only
 * (never auto-submits), and finish routing follows the design data flow:
 * 1v1 -> wait-room rematch, bracket+finalRanking -> ranking,
 * bracket+noFinalRanking -> wait/go-now choice.
 */

/**
 * Presentation-only countdown (#10): it ticks and resets per turn but NEVER
 * submits an action on expiry — the server owns turn resolution.
 */
function TimerRing({
  seconds,
  active,
  turnKey,
}: {
  seconds: number
  active: boolean
  turnKey: number
}) {
  const [remaining, setRemaining] = useState(seconds)

  // Reset the countdown whenever a new turn starts.
  useEffect(() => {
    setRemaining(seconds)
  }, [seconds, turnKey])

  // One 1-second tick per remaining unit while the timer is armed.
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => clearInterval(id)
  }, [active, turnKey, seconds])

  return (
    <div
      className="duel-timer"
      data-testid="timer-ring"
    >
      <span className="pd-stat pd-stat--xl" style={{ color: 'var(--pd-yellow)' }}>
        {String(remaining).padStart(2, '0')}
      </span>
    </div>
  )
}

function MoveButton({
  index,
  disabled,
  pp,
  onAttack,
}: {
  index: MoveIndex
  disabled: boolean
  pp: number
  onAttack: (index: MoveIndex) => void
}) {
  const slot = MOVE_SLOTS[index]
  const basic = isBasicAttack(index)
  return (
    <button
      type="button"
      className={`pd-card move-btn${basic ? ' move-btn--weak' : ''}`}
      disabled={disabled}
      onClick={() => onAttack(index)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <span style={{ font: '800 16px/1.2 var(--pd-font-display)', color: '#fff', textTransform: 'uppercase' }}>
          {slot.name}
        </span>
        <span style={{ font: '700 13px/1 var(--pd-font-mono)', color: basic ? 'var(--pd-text-meta)' : 'var(--pd-blue-light)' }}>
          {moveDamageLabel(index)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <span className="pd-badge" style={{ background: 'rgba(120,180,255,.14)', color: 'var(--pd-text-meta)' }}>
          {basic ? 'PP ∞' : `PP ${pp}/4`}
        </span>
      </div>
    </button>
  )
}

function MoveButtonGrid({
  disabled,
  active,
  onAttack,
}: {
  disabled: boolean
  active: DuelPokemonState | undefined
  onAttack: (index: MoveIndex) => void
}) {
  // Insufficient-PP prevention: a move with 0 remaining PP is shown disabled
  // and non-selectable (basic attack has infinite PP).
  const ppOf = (index: MoveIndex): number => {
    if (index === BASIC_ATTACK_INDEX) return Infinity
    if (!active) return 0
    if (index === 0) return active.ppMove1
    if (index === 1) return active.ppMove2
    return active.ppMove3
  }
  return (
    <div className="move-grid">
      {MOVE_SLOTS.map((_, i) => (
        <MoveButton
          key={i}
          index={i as MoveIndex}
          disabled={disabled || ppOf(i as MoveIndex) <= 0}
          pp={ppOf(i as MoveIndex)}
          onAttack={onAttack}
        />
      ))}
    </div>
  )
}

function LeadPicker({
  roster,
  onPick,
}: {
  roster: DuelPokemonState[]
  onPick: (pokemonId: number) => void
}) {
  // Cosmetic-only countdown (spec: "MUST be cosmetic and MUST NOT auto-submit
  // on expiry") — the server owns lead selection; when the timer hits zero the
  // pick buttons simply remain available.
  const [remaining, setRemaining] = useState(LEAD_SELECTION_TIMEOUT_SECONDS)
  useEffect(() => {
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="lead-picker" data-testid="lead-picker">
      <h2 className="pd-title" style={{ margin: 0 }}>
        ELIGE TU PRIMER POKÉMON
      </h2>
      <p className="pd-body" style={{ margin: '8px 0 16px' }}>
        Selecciona el Pokémon que abrirá el combate.
      </p>
      <p
        data-testid="lead-countdown"
        className="pd-stat pd-stat--xl"
        style={{ color: 'var(--pd-yellow)', margin: '0 0 12px' }}
      >
        {String(remaining).padStart(2, '0')}
      </p>
      <div className="lead-grid">
        {roster.map((p) => (
          <button
            key={p.pokemonId}
            type="button"
            className="pd-card pd-card--flush pd-card--interactive lead-card"
            aria-label={p.name}
            onClick={() => onPick(p.pokemonId)}
          >
            <div className="art">
              {p.spriteUrl ? (
                <img src={p.spriteUrl} alt="" />
              ) : (
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={{ fontSize: 56, color: 'var(--pd-text-dim)' }}
                >
                  pets
                </span>
              )}
              <span className={`pd-badge pd-badge--${p.type} type-tag`}>{p.type.toUpperCase()}</span>
            </div>
            <div className="meta">
              <h4>{p.name.toUpperCase()}</h4>
              <span className="lead-card__cta">
                <span className="material-symbols-outlined" aria-hidden="true">
                  bolt
                </span>
                ELEGIR
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Wait-vs-go-now choice shown after a bracket duel while the room is still open. */
function PostDuelChoice({
  waiting,
  onWait,
  onGoNow,
}: {
  waiting: boolean
  onWait: () => void
  onGoNow: () => void
}) {
  if (waiting) {
    return (
      <div data-testid="post-duel-choice">
        <p role="status" className="pd-label" style={{ color: 'var(--pd-yellow)', margin: 0 }}>
          ESPERANDO RESULTADOS FINALES…
        </p>
      </div>
    )
  }
  return (
    <div data-testid="post-duel-choice">
      <h2 className="pd-title" style={{ margin: 0 }}>
        ¿ESPERAR O VER RESULTADOS?
      </h2>
      <p className="pd-body" style={{ margin: '8px 0 16px' }}>
        Tu duelo terminó y la sala sigue abierta. Puedes esperar el resultado
        final o ver una clasificación provisional ahora.
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button type="button" className="pd-btn pd-btn--secondary" onClick={onWait}>
          ESPERAR
        </button>
        <button type="button" className="pd-btn pd-btn--primary" onClick={onGoNow}>
          IR YA
        </button>
      </div>
    </div>
  )
}

/**
 * Between bracket rounds (Fase 7.1): after winning a versus, the next duel
 * opens in lead_selection. Instead of dropping the player straight onto the
 * picker, this modal asks whether to keep the pokemon they won with or pick a
 * fresh one — CONTINUAR auto-submits that lead, CAMBIAR POKÉMON reveals the
 * normal LeadPicker.
 */
function PostVictoryLeadModal({
  onContinue,
  onChange,
}: {
  onContinue: () => void
  onChange: () => void
}) {
  const continueRef = useRef<HTMLButtonElement>(null)
  return (
    <Modal ariaLabel="Ganaste el versus" onClose={onChange} initialFocusRef={continueRef}>
      <h2 className="pd-title" style={{ marginBottom: 8 }}>
        ¡GANASTE ESTE VERSUS!
      </h2>
      <p className="pd-body" style={{ marginBottom: 24 }}>
        ¿Quieres seguir con este Pokémon o elegir uno nuevo?
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button type="button" ref={continueRef} className="pd-btn pd-btn--primary" onClick={onContinue}>
          CONTINUAR
        </button>
        <button type="button" className="pd-btn pd-btn--secondary" onClick={onChange}>
          CAMBIAR POKÉMON
        </button>
      </div>
    </Modal>
  )
}

/**
 * Custom surrender confirmation (RF-7.7): a Tailwind/design-system modal
 * instead of the native window.confirm. Confirming emits duel:surrender,
 * canceling resumes it.
 */
function SurrenderConfirmModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void
  onCancel: () => void
}) {
  // Thin <Modal> consumer (design A4): the generic overlay + pd-card dialog
  // shell + focus trap live in components/Modal. This screen-specific wrapper
  // stays in-file so DuelBoardScreen.test.tsx keeps importing it from here
  // (zero test edits). Initial focus lands on the safe action (SEGUIR
  // LUCHANDO); Tab/Shift+Tab cycle between the two buttons and Escape acts as
  // cancel.
  const cancelBtnRef = useRef<HTMLButtonElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal ariaLabel="Confirmar rendirse" onClose={onCancel} initialFocusRef={cancelBtnRef}>
      <h2 className="pd-title" style={{ marginBottom: 8 }}>
        ¿RENDIRSE?
      </h2>
      <p className="pd-body" style={{ marginBottom: 24 }}>
        Si te rindes, el duelo termina y pierdes el combate.
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button type="button" ref={confirmBtnRef} className="pd-btn pd-btn--danger" onClick={onConfirm}>
          <span className="material-symbols-outlined" aria-hidden="true">
            logout
          </span>
          RENDIRSE
        </button>
        <button type="button" ref={cancelBtnRef} className="pd-btn pd-btn--secondary" onClick={onCancel}>
          SEGUIR LUCHANDO
        </button>
      </div>
    </Modal>
  )
}

function SurrenderButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="pd-btn pd-btn--danger" onClick={onClick}>
      <span className="material-symbols-outlined" aria-hidden="true">
        logout
      </span>
      RENDIRSE / SALIR
    </button>
  )
}

function DuelBoardScreen() {
  const [state, actions] = useMockState()
  const [showSurrender, setShowSurrender] = useState(false)
  const [waitingForFinal, setWaitingForFinal] = useState(false)
  const { duel } = state
  const navigate = useNavigate()
  const handledDuelId = useRef<string | null>(null)

  // Fase 7.1 — between bracket rounds: remember the pokemon a win ended with
  // and, when the next round opens in lead_selection, prompt "keep it or pick
  // fresh" before the picker (PostVictoryLeadModal) instead of forcing a
  // from-scratch selection.
  const wonBracketDuelIdRef = useRef<string | null>(null)
  const keepLeadPokemonIdRef = useRef<number | null>(null)
  const postVictoryPromptedDuelIdRef = useRef<string | null>(null)
  const [showPostVictoryLead, setShowPostVictoryLead] = useState(false)

  // Bot actions are server-controlled (backend/ws/botManager.js + duelHandlers
  // auto-fill lead/turn/switch for bot players) — the client never impersonates
  // a bot on the human's socket.

  // KO detection: the server snapshot flips the duel to awaiting_switch when
  // the human active faints with bench remaining — send the player to the
  // forced swap. Hooks must run unconditionally (Rules of Hooks), so the
  // `duel` null-check lives inside the effect body.
  useEffect(() => {
    if (!duel) return
    if (duel.phase === 'awaiting_switch') {
      navigate('/swap?mode=forced', { replace: true })
    }
  }, [duel, navigate])

  // Duel finish routing (server-driven): 1v1 -> wait-room rematch panel;
  // bracket + final ranking -> ranking screen; bracket + no final ranking ->
  // stay and render the wait/go-now choice (the effect re-runs and navigates
  // once room:final_ranking lands — the handledDuelId guard is only set when a
  // navigation actually happens).
  useEffect(() => {
    if (!duel || duel.phase !== 'finished') return
    if (handledDuelId.current === duel.duelId) return
    const route = computePostDuelRoute(state)
    if (!route) return
    handledDuelId.current = duel.duelId
    navigate(route.path, { replace: true })
  }, [duel, state, navigate])

  // Fase 7.1 — post-victory lead prompt (bracket only):
  //  1. on a bracket win, capture the pokemon that was still standing;
  //  2. when a *different* duel then enters lead_selection, raise the
  //     keep-or-change modal once for that duel.
  useEffect(() => {
    if (!duel || state.tournament == null) return

    if (duel.phase === 'finished') {
      if (
        duel.winnerId === state.player.playerId &&
        wonBracketDuelIdRef.current !== duel.duelId
      ) {
        wonBracketDuelIdRef.current = duel.duelId
        keepLeadPokemonIdRef.current = humanActivePokemon(state)?.pokemonId ?? null
      }
      return
    }

    if (
      duel.phase === 'lead_selection' &&
      keepLeadPokemonIdRef.current != null &&
      duel.duelId !== wonBracketDuelIdRef.current &&
      postVictoryPromptedDuelIdRef.current !== duel.duelId
    ) {
      postVictoryPromptedDuelIdRef.current = duel.duelId
      setShowPostVictoryLead(true)
    }
  }, [duel, state])

  // Mid-duel reconnection (spec: Mid-Duel Reconnection): a fresh mount with an
  // in-progress duel re-emits duel:join so the server resyncs duel:state —
  // a page refresh mid-duel must not keep rendering stale localStorage state.
  // Mount-scoped on purpose: re-emitting on every duel change would spam the
  // server. The ref guard makes it emit exactly once per mount (StrictMode-safe)
  // while a remount gets a fresh ref and re-syncs against the current duel.
  const resyncedDuelId = useRef<string | null>(null)
  useEffect(() => {
    if (!duel || duel.phase === 'finished') return
    if (resyncedDuelId.current === duel.duelId) return
    resyncedDuelId.current = duel.duelId
    actions.joinDuel(duel.duelId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fase 7 (PR8): the attack replay walks the transient attackSequence and
  // locks the controls while it runs. Declared before the `!duel` redirect —
  // the hook accepts a null duel (Rules of Hooks).
  const humanSpriteRef = useRef<HTMLImageElement>(null)
  const rivalSpriteRef = useRef<HTMLImageElement>(null)
  const { replaying } = useAttackReplay(
    duel,
    state.player.playerId,
    humanSpriteRef,
    rivalSpriteRef,
  )

  // The `!duel` redirect happens AFTER every hook above has been declared —
  // moving it earlier would make hook calls conditional (see Rules of Hooks).
  if (!duel) {
    return <Navigate to="/wait-room" replace />
  }

  const humanActive = humanActivePokemon(state)
  const rivalActive = rivalActivePokemon(state)
  // Round-1 gate: the rival lead is not broadcast until the first
  // duel:turn_resolved, so the move grid must not wait on rivalActive.
  const canAct =
    duel.phase === 'awaiting_actions' && Boolean(humanActive) && !replaying

  const handleAttack = (index: MoveIndex) => {
    actions.submitAction(index)
  }

  const isTournament = state.tournament != null
  const showPostDuelChoice = duel.phase === 'finished' && isTournament && state.finalRanking == null
  const myRoster = state.duelPokemonState.filter(
    (p) => p.ownerId === Number(state.player.playerId),
  )

  return (
    <div className="pd-page duel-shell">
      <ScreenTopbar nickname={state.player.nickname}>
        <SurrenderButton onClick={() => setShowSurrender(true)} />
      </ScreenTopbar>

      {showSurrender && (
        <SurrenderConfirmModal
          onConfirm={() => {
            actions.surrenderDuel()
            setShowSurrender(false)
          }}
          onCancel={() => setShowSurrender(false)}
        />
      )}

      <main id="main-content" className="duel-main">
        <div className="duel-arena">
          <div className="pd-scrim-v" />
          <div className="pd-scrim-d" />

          <TimerRing
            seconds={TURN_TIMEOUT_SECONDS}
            active={duel.phase === 'awaiting_actions' && canAct}
            turnKey={duel.turnNumber}
          />

          <div
            className="duel-hud"
          >
            {humanActive && <HudCard pokemon={humanActive} side="human" />}
            {rivalActive && <HudCard pokemon={rivalActive} side="rival" />}
          </div>

          {/* Free-standing arena field sprites (Prototipos/5): own pokemon
              seen from the back, rival from the front. PR8 attaches the
              attack-replay keyframes to these wrappers. */}
          {humanActive && (
            <div className="sprite-wrap">
              <img
                ref={humanSpriteRef}
                src={humanActive.backSpriteUrl}
                alt={humanActive.name}
              />
            </div>
          )}
          {rivalActive && (
            <div className="sprite-wrap sprite-wrap--rival">
              <img
                ref={rivalSpriteRef}
                src={rivalActive.spriteUrl}
                alt={rivalActive.name}
              />
            </div>
          )}
        </div>

        <div
          className="duel-command"
        >
          {duel.opponentDisconnected && (
            <p role="status" className="pd-label" style={{ color: 'var(--pd-danger)', margin: 0 }}>
              TU RIVAL SE DESCONECTÓ
            </p>
          )}
          {duel.lastRejection && (
            <p role="status" className="pd-label" style={{ color: 'var(--pd-yellow)', margin: 0 }}>
              MOVIMIENTO RECHAZADO — {duel.lastRejection.reason}
            </p>
          )}
          {duel.phase === 'lead_selection' ? (
            <>
              <LeadPicker roster={myRoster} onPick={(pokemonId) => actions.selectLead(pokemonId)} />
              {showPostVictoryLead && (
                <PostVictoryLeadModal
                  onContinue={() => {
                    const keepId = keepLeadPokemonIdRef.current
                    if (keepId != null && myRoster.some((p) => p.pokemonId === keepId)) {
                      actions.selectLead(keepId)
                    }
                    keepLeadPokemonIdRef.current = null
                    setShowPostVictoryLead(false)
                  }}
                  onChange={() => {
                    keepLeadPokemonIdRef.current = null
                    setShowPostVictoryLead(false)
                  }}
                />
              )}
            </>
          ) : showPostDuelChoice ? (
            <PostDuelChoice
              waiting={waitingForFinal}
              onWait={() => setWaitingForFinal(true)}
              onGoNow={() => navigate('/ranking')}
            />
          ) : (
            <div style={{ display: 'flex', gap: 16, flex: 1, flexDirection: 'column' }}>
              <MoveButtonGrid disabled={!canAct} active={humanActive} onAttack={handleAttack} />
              <div className="side-panel">
                <button
                  type="button"
                  className="pd-btn pd-btn--secondary"
                  disabled={!canAct}
                  onClick={() => navigate('/swap?mode=voluntary')}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    swap_horiz
                  </span>
                  CAMBIAR POKÉMON
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default DuelBoardScreen
export { MoveButton, MoveButtonGrid, SurrenderButton, SurrenderConfirmModal, TimerRing }
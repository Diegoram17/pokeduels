import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import type { DuelPokemonState } from '../state/schema'
import type { MoveIndex } from '../engine/damage'
import { humanActivePokemon, rivalActivePokemon, computePostDuelRoute } from '../lib/duelFlow'
import {
  BASIC_ATTACK_INDEX,
  LEAD_SELECTION_TIMEOUT_SECONDS,
  MAX_HP,
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

function HpBar({ hp }: { hp: number }) {
  const pct = Math.max(0, Math.min(100, (hp / MAX_HP) * 100))
  const tone =
    pct > 50 ? 'pd-hp-fill--high' : pct > 20 ? 'pd-hp-fill--mid' : 'pd-hp-fill--low'
  return (
    <div
      className="pd-hp-bar"
      role="progressbar"
      aria-label="HP"
      aria-valuenow={hp}
      aria-valuemin={0}
      aria-valuemax={MAX_HP}
    >
      <div className={`pd-hp-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function HudCard({ pokemon, side }: { pokemon: DuelPokemonState; side: 'human' | 'rival' }) {
  const isRival = side === 'rival'
  return (
    <div
      className="pd-card"
      data-testid={`hud-${side}`}
      style={{
        width: 280,
        padding: 12,
        pointerEvents: 'auto',
        ...(isRival ? { borderRight: '4px solid var(--pd-red)' } : {}),
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}
      >
        <img
          src={isRival ? pokemon.spriteUrl : pokemon.backSpriteUrl}
          alt={pokemon.name}
          style={{
            width: isRival ? 120 : 110,
            height: isRival ? 120 : 110,
            objectFit: 'contain',
            imageRendering: 'pixelated',
            filter: 'drop-shadow(0 10px 20px rgba(90,170,255,.35))',
          }}
        />
      </div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}
      >
        <span
          style={{ font: '800 18px/1.2 var(--pd-font-display)', color: '#fff', textTransform: 'uppercase' }}
        >
          {pokemon.name.toUpperCase()}
        </span>
        <span
          style={{ font: '700 14px/1 var(--pd-font-mono)', color: isRival ? 'var(--pd-danger)' : 'var(--pd-yellow)' }}
        >
          Lv.50
        </span>
      </div>
      <div
        style={{ display: 'flex', gap: 4, marginBottom: 8, ...(isRival ? { justifyContent: 'flex-end' } : {}) }}
      >
        <span className={`pd-badge pd-badge--${pokemon.type}`}>{pokemon.type.toUpperCase()}</span>
      </div>
      <HpBar hp={pokemon.currentHp} />
      <div
        style={{ display: 'flex', justifyContent: isRival ? 'flex-start' : 'flex-end', marginTop: 4 }}
      >
        <span className="pd-stat" style={{ fontSize: 13 }}>
          {pokemon.currentHp}/{MAX_HP}
        </span>
      </div>
    </div>
  )
}

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
      data-testid="timer-ring"
      style={{
        position: 'absolute',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        width: 80,
        height: 80,
        borderRadius: '50%',
        background: 'rgba(9,16,40,.7)',
        border: '2px solid var(--pd-yellow)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 15px rgba(255,203,5,.5)',
      }}
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
      className="pd-card"
      disabled={disabled}
      onClick={() => onAttack(index)}
      style={{
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 8,
        padding: 16,
        cursor: 'pointer',
        borderLeft: basic ? '4px solid var(--pd-border-blue)' : '4px solid var(--pd-blue-light)',
      }}
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
    <div data-testid="lead-picker">
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
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {roster.map((p) => (
          <button
            key={p.pokemonId}
            type="button"
            className="pd-btn pd-btn--primary"
            aria-label={p.name}
            onClick={() => onPick(p.pokemonId)}
          >
            <span className="pd-stat">{p.name.toUpperCase()}</span>
            <span className="pd-meta">ELEGIR</span>
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
  // Hand-rolled focus trap for a 2-button dialog (design UX4): initial focus
  // on the safe action, Tab/Shift+Tab toggle between the two buttons (the
  // transition is identical in both directions with exactly 2 focusables),
  // Escape acts as cancel, and the scoped keydown listener is removed on
  // unmount so it cannot fire for keys pressed afterward.
  const cancelBtnRef = useRef<HTMLButtonElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelBtnRef.current?.focus()

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel()
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const next =
          document.activeElement === confirmBtnRef.current
            ? cancelBtnRef.current
            : confirmBtnRef.current
        next?.focus()
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [onCancel])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(4,7,18,.78)',
        backdropFilter: 'blur(4px)',
        padding: 24,
      }}
    >
      <div
        className="pd-card"
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar rendirse"
        style={{ maxWidth: 420, width: '100%', textAlign: 'center', padding: 32 }}
      >
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
      </div>
    </div>
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

  // The `!duel` redirect happens AFTER every hook above has been declared —
  // moving it earlier would make hook calls conditional (see Rules of Hooks).
  if (!duel) {
    return <Navigate to="/wait-room" replace />
  }

  const humanActive = humanActivePokemon(state)
  const rivalActive = rivalActivePokemon(state)
  // Round-1 gate: the rival lead is not broadcast until the first
  // duel:turn_resolved, so the move grid must not wait on rivalActive.
  const canAct = duel.phase === 'awaiting_actions' && Boolean(humanActive)

  const handleAttack = (index: MoveIndex) => {
    actions.submitAction(index)
  }

  const isTournament = state.tournament != null
  const showPostDuelChoice = duel.phase === 'finished' && isTournament && state.finalRanking == null

  return (
    <div className="pd-page" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header className="pd-topbar">
        <span className="pd-logo pd-logo--sm">Poke-duels</span>
        <div className="pd-topbar__end">
          <span className="pd-meta">{state.player.nickname.toUpperCase() || 'ENTRENADOR'}</span>
          <SurrenderButton onClick={() => setShowSurrender(true)} />
        </div>
      </header>

      {showSurrender && (
        <SurrenderConfirmModal
          onConfirm={() => {
            actions.surrenderDuel()
            setShowSurrender(false)
          }}
          onCancel={() => setShowSurrender(false)}
        />
      )}

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
          <LeadPicker
            roster={state.duelPokemonState.filter(
              (p) => p.ownerId === Number(state.player.playerId),
            )}
            onPick={(pokemonId) => actions.selectLead(pokemonId)}
          />
        ) : showPostDuelChoice ? (
          <PostDuelChoice
            waiting={waitingForFinal}
            onWait={() => setWaitingForFinal(true)}
            onGoNow={() => navigate('/ranking')}
          />
        ) : (
          <div style={{ display: 'flex', gap: 16, flex: 1, flexDirection: 'column' }}>
            <MoveButtonGrid disabled={!canAct} active={humanActive} onAttack={handleAttack} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
    </div>
  )
}

export default DuelBoardScreen
export { HudCard, HpBar, MoveButton, MoveButtonGrid, SurrenderButton, SurrenderConfirmModal, TimerRing }
import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import type { DuelPokemonState } from '../state/schema'
import type { MoveIndex } from '../engine/damage'
import { humanActivePokemon, rivalActivePokemon, computePostDuelRoute } from '../lib/duelFlow'
import {
  BASIC_ATTACK_INDEX,
  MAX_HP,
  MOVE_SLOTS,
  TIMEOUT_NOTICE,
  TURN_TIMEOUT_SECONDS,
  isBasicAttack,
  moveDamageLabel,
} from '../lib/duelBoard'

/**
 * Screen 5: Duel Board. Renders the HUD for both sides, the 4-move attack
 * grid, and a per-turn countdown that auto-resolves as a basic attack on
 * timeout (RF-6.1).
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
        className="hud-top"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}
      >
        <span
          className="hud-name"
          style={{ font: '800 18px/1.2 var(--pd-font-display)', color: '#fff', textTransform: 'uppercase' }}
        >
          {pokemon.name.toUpperCase()}
        </span>
        <span
          className="hud-lvl"
          style={{ font: '700 14px/1 var(--pd-font-mono)', color: isRival ? 'var(--pd-danger)' : 'var(--pd-yellow)' }}
        >
          Lv.50
        </span>
      </div>
      <div
        className="hud-badges"
        style={{ display: 'flex', gap: 4, marginBottom: 8, ...(isRival ? { justifyContent: 'flex-end' } : {}) }}
      >
        <span className={`pd-badge pd-badge--${pokemon.type}`}>{pokemon.type.toUpperCase()}</span>
      </div>
      <HpBar hp={pokemon.currentHp} />
      <div
        className="hud-hp-foot"
        style={{ display: 'flex', justifyContent: isRival ? 'flex-start' : 'flex-end', marginTop: 4 }}
      >
        <span className="pd-stat" style={{ fontSize: 13 }}>
          {pokemon.currentHp}/{MAX_HP}
        </span>
      </div>
    </div>
  )
}

function TimerRing({
  seconds,
  active,
  turnKey,
  onTimeout,
}: {
  seconds: number
  active: boolean
  turnKey: number
  onTimeout: () => void
}) {
  const [remaining, setRemaining] = useState(seconds)
  const firedRef = useRef(false)

  // Reset the countdown whenever a new turn starts.
  useEffect(() => {
    setRemaining(seconds)
    firedRef.current = false
  }, [seconds, turnKey])

  // One 1-second tick per remaining unit while the timer is armed.
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => clearInterval(id)
  }, [active, turnKey, seconds])

  // Fire the timeout exactly once when the countdown reaches zero.
  useEffect(() => {
    if (remaining > 0 || !active || firedRef.current) return
    firedRef.current = true
    onTimeout()
  }, [remaining, active, onTimeout])

  return (
    <div
      className="duel-timer"
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
  onAttack,
}: {
  index: MoveIndex
  disabled: boolean
  onAttack: (index: MoveIndex) => void
}) {
  const slot = MOVE_SLOTS[index]
  const basic = isBasicAttack(index)
  return (
    <button
      type="button"
      className="pd-card move-btn"
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
        <span className="move-name" style={{ font: '800 16px/1.2 var(--pd-font-display)', color: '#fff', textTransform: 'uppercase' }}>
          {slot.name}
        </span>
        <span className="move-dmg" style={{ font: '700 13px/1 var(--pd-font-mono)', color: basic ? 'var(--pd-text-meta)' : 'var(--pd-blue-light)' }}>
          {moveDamageLabel(index)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <span className="pd-badge" style={{ background: 'rgba(120,180,255,.14)', color: 'var(--pd-text-meta)' }}>
          {basic ? 'PP ∞' : 'PP 4/4'}
        </span>
      </div>
    </button>
  )
}

function MoveButtonGrid({
  disabled,
  onAttack,
}: {
  disabled: boolean
  onAttack: (index: MoveIndex) => void
}) {
  return (
    <div className="move-grid" style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
      {MOVE_SLOTS.map((_, i) => (
        <MoveButton key={i} index={i as MoveIndex} disabled={disabled} onAttack={onAttack} />
      ))}
    </div>
  )
}

/**
 * Custom surrender confirmation (RF-7.7): a Tailwind/design-system modal
 * instead of the native window.confirm. Confirming ends the duel as a loss,
 * canceling resumes it.
 */
function SurrenderConfirmModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void
  onCancel: () => void
}) {
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
          <button type="button" className="pd-btn pd-btn--danger" onClick={onConfirm}>
            <span className="material-symbols-outlined" aria-hidden="true">
              logout
            </span>
            RENDIRSE
          </button>
          <button type="button" className="pd-btn pd-btn--secondary" onClick={onCancel}>
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
  const [timeoutNotice, setTimeoutNotice] = useState(false)
  const [showSurrender, setShowSurrender] = useState(false)
  const { duel } = state
  const navigate = useNavigate()
  const handledDuelId = useRef<string | null>(null)

  // KO detection: the engine flips the duel to awaiting_switch when the human
  // active faints with bench remaining — send the player to the forced swap.
  // Hooks must run unconditionally on every render (Rules of Hooks), so the
  // `duel` null-check lives inside the effect body instead of gating the
  // hook call itself.
  useEffect(() => {
    if (!duel) return
    if (duel.phase === 'awaiting_switch') {
      navigate('/swap?mode=forced', { replace: true })
    }
  }, [duel, navigate])

  // Duel finish: record the result in the tournament (when applicable), then
  // route back to the wait room if slots remain, or to the ranking screen.
  useEffect(() => {
    if (!duel) return
    if (duel.phase !== 'finished') return
    if (handledDuelId.current === duel.duelId) return
    handledDuelId.current = duel.duelId
    if (state.tournament) actions.advanceTournament()
    const route = computePostDuelRoute(state)
    if (route) navigate(route.path, { replace: true })
  }, [duel, state.tournament, state, actions, navigate])

  const handleTimeout = useCallback(() => {
    setTimeoutNotice(true)
    actions.applyPlayerAttack(BASIC_ATTACK_INDEX)
  }, [actions])

  // The `!duel` redirect happens AFTER every hook above has been declared —
  // moving it earlier would make hook calls conditional (see Rules of Hooks).
  if (!duel) {
    return <Navigate to="/wait-room" replace />
  }

  const humanActive = humanActivePokemon(state)
  const rivalActive = rivalActivePokemon(state)
  const canAct = duel.phase === 'awaiting_actions' && Boolean(humanActive) && Boolean(rivalActive)

  const handleAttack = (index: MoveIndex) => {
    setTimeoutNotice(false)
    actions.applyPlayerAttack(index)
  }

  return (
    <div className="pd-page" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header
        className="duel-topbar"
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          height: 64,
          background: 'rgba(5,8,20,.82)',
          backdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--pd-border-blue-dim)',
          zIndex: 30,
        }}
      >
        <span className="pd-logo pd-logo--sm">Poke-duels</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="pd-meta">{state.player.nickname.toUpperCase() || 'ENTRENADOR'}</span>
          <SurrenderButton onClick={() => setShowSurrender(true)} />
        </div>
      </header>

      {showSurrender && (
        <SurrenderConfirmModal
          onConfirm={() => {
            actions.surrender()
            setShowSurrender(false)
          }}
          onCancel={() => setShowSurrender(false)}
        />
      )}

      <div className="duel-arena" style={{ position: 'relative', height: '55vh', flex: 'none', overflow: 'hidden' }}>
        <div className="pd-scrim-v" />
        <div className="pd-scrim-d" />

        <TimerRing
          seconds={TURN_TIMEOUT_SECONDS}
          active={duel.phase === 'awaiting_actions' && canAct}
          turnKey={duel.turnNumber}
          onTimeout={handleTimeout}
        />

        <div
          className="duel-hud"
          style={{
            position: 'absolute',
            inset: 0,
            padding: 24,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {humanActive && <HudCard pokemon={humanActive} side="human" />}
          {rivalActive && <HudCard pokemon={rivalActive} side="rival" />}
        </div>
      </div>

      <div
        className="duel-command"
        style={{
          flex: 1,
          background: 'rgba(5,8,20,.9)',
          borderTop: '1px solid var(--pd-border-blue-dim)',
          padding: '24px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          position: 'relative',
          zIndex: 20,
          overflowY: 'auto',
        }}
      >
        {timeoutNotice && (
          <p role="status" className="pd-label" style={{ color: 'var(--pd-yellow)', margin: 0 }}>
            {TIMEOUT_NOTICE}
          </p>
        )}
        <div style={{ display: 'flex', gap: 16, flex: 1, flexDirection: 'column' }}>
          <MoveButtonGrid disabled={!canAct} onAttack={handleAttack} />
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
      </div>
    </div>
  )
}

export default DuelBoardScreen
export { HudCard, HpBar, MoveButton, MoveButtonGrid, SurrenderButton, SurrenderConfirmModal, TimerRing }
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import type { DuelPokemonState, DuelState } from '../state/schema'
import { MAX_HP } from '../lib/duelBoard'

/**
 * Screen 6: Pokémon Swap. In forced mode (after a KO) the player MUST pick a
 * bench pokemon and no cancel exists; in voluntary mode "volver al combate"
 * cancels with no swap. Confirming records the new active pokemon before
 * returning to the duel board.
 */

type SwapMode = 'forced' | 'voluntary'

function BenchPokemonCard({
  pokemon,
  selected,
  onSelect,
}: {
  pokemon: DuelPokemonState
  selected: boolean
  onSelect: (pokemonId: number) => void
}) {
  const isActive = pokemon.isActive
  const isKo = pokemon.fainted || pokemon.currentHp === 0
  const selectable = !isActive && !isKo

  return (
    <div
      className={`pd-card pd-card--flush${selectable ? ' pd-card--interactive' : ''}${isActive ? ' pd-card--active' : ''}`}
      data-testid={`bench-card-${pokemon.pokemonId}`}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}
    >
      {isActive && (
        <span
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 5,
            padding: '4px 8px',
            borderRadius: 'var(--pd-radius-sm)',
            font: '700 10px/1 var(--pd-font-mono)',
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            background: 'var(--pd-yellow)',
            color: '#1a1400',
          }}
        >
          EN CAMPO
        </span>
      )}
      <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(6,12,30,.5)' }}>
        {pokemon.spriteUrl ? (
          <img
            src={pokemon.spriteUrl}
            alt={pokemon.name}
            style={{ width: 96, height: 96, objectFit: 'contain', imageRendering: 'pixelated' }}
          />
        ) : (
          <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 56, color: 'var(--pd-text-dim)' }}>
            pets
          </span>
        )}
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h2 style={{ margin: 0, font: '800 19px/1.2 var(--pd-font-display)', color: '#fff', textTransform: 'uppercase' }}>
            {pokemon.name.toUpperCase()}
          </h2>
          <span className={`pd-badge pd-badge--${pokemon.type}`}>{pokemon.type.toUpperCase()}</span>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: '700 13px/1 var(--pd-font-mono)', color: isKo ? 'var(--pd-danger)' : 'var(--pd-text-meta)', marginBottom: 4 }}>
            <span>HP</span>
            <span>
              {pokemon.currentHp} / {MAX_HP}
            </span>
          </div>
          <div
            className="pd-hp-bar"
            role="progressbar"
            aria-label={`HP de ${pokemon.name}`}
            aria-valuenow={pokemon.currentHp}
            aria-valuemin={0}
            aria-valuemax={MAX_HP}
          >
            <div
              className={`pd-hp-fill ${pokemon.currentHp > 50 ? 'pd-hp-fill--high' : pokemon.currentHp > 20 ? 'pd-hp-fill--mid' : 'pd-hp-fill--low'}`}
              style={{ width: `${Math.max(0, Math.min(100, pokemon.currentHp))}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          className={`pd-btn pd-btn--block${selectable ? ' pd-btn--primary' : ''}`}
          disabled={!selectable}
          aria-pressed={selectable ? selected : undefined}
          aria-label={`${pokemon.name}${isActive ? ' — desplegado actualmente' : isKo ? ' — fuera de servicio' : ''}`}
          onClick={() => selectable && onSelect(pokemon.pokemonId)}
          style={selectable && selected ? { outline: '2px solid var(--pd-yellow)', outlineOffset: 2 } : undefined}
        >
          {isActive ? 'DESPLEGADO ACTUALMENTE' : isKo ? 'UNIDAD FUERA DE SERVICIO' : selected ? 'SELECCIONADO' : 'ENVIAR AL COMBATE'}
        </button>
      </div>
    </div>
  )
}

function BenchList({
  pokemon,
  selectedId,
  onSelect,
}: {
  pokemon: DuelPokemonState[]
  selectedId: number | null
  onSelect: (pokemonId: number) => void
}) {
  return (
    <div
      className="bench-grid"
      data-testid="bench-list"
    >
      {pokemon.map((p) => (
        <BenchPokemonCard
          key={p.pokemonId}
          pokemon={p}
          selected={selectedId === p.pokemonId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function ConfirmSwapButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="pd-btn pd-btn--primary pd-btn--lg" disabled={disabled} onClick={onClick}>
      <span className="material-symbols-outlined" aria-hidden="true">
        swap_horiz
      </span>
      CONFIRMAR CAMBIO
      <span className="pd-btn__shine" />
    </button>
  )
}

function CancelSwapButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="pd-btn pd-btn--ghost" onClick={onClick}>
      <span className="material-symbols-outlined" aria-hidden="true">
        logout
      </span>
      VOLVER AL COMBATE
    </button>
  )
}

function SwapScreen() {
  const [state, actions] = useMockState()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [pendingSwap, setPendingSwap] = useState<number | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const { duel, duelPokemonState, player } = state
  // Snapshot of lastRejection at submit time — a rejection left over from a
  // PREVIOUS attempt keeps the same object reference until a new snapshot or
  // rejection replaces it, so comparing by reference (not just moveIndex)
  // stops a stale rejection from instantly failing the next retry.
  const submittedRejectionRef = useRef<DuelState['lastRejection']>(null)

  // Bug 6: navigate only once the server confirms — the duel:state broadcast
  // emitted after a successful applySwitchDecision flips the target to
  // isActive. Emit-and-navigate would race the server write and show stale
  // state on the board.
  useEffect(() => {
    if (pendingSwap == null) return
    const target = duelPokemonState.find((p) => p.pokemonId === pendingSwap)
    if (target?.isActive) {
      setPendingSwap(null)
      navigate('/duel')
    }
  }, [pendingSwap, duelPokemonState, navigate])

  // If the server rejects the switch (duel:switch_rejected -> lastRejection
  // with moveIndex null), stay put and surface the reason so the player can
  // retry instead of bouncing back to the board with the old active pokemon.
  useEffect(() => {
    if (pendingSwap == null) return
    const rejection = duel?.lastRejection
    if (
      rejection &&
      rejection.moveIndex == null &&
      rejection !== submittedRejectionRef.current
    ) {
      setSwitchError(rejection.reason)
      setPendingSwap(null)
    }
  }, [pendingSwap, duel])

  if (!duel) {
    return <Navigate to="/duel" replace />
  }

  const mode: SwapMode = searchParams.get('mode') === 'forced' ? 'forced' : 'voluntary'
  // Numeric server-issued identity: the player side matches Number(playerId).
  const myPokemon = duelPokemonState.filter((p) => p.ownerId === Number(player.playerId))

  const handleSelect = (pokemonId: number) => {
    setSelectedId((current) => (current === pokemonId ? null : pokemonId))
  }

  const handleConfirm = () => {
    if (selectedId == null) return
    setSwitchError(null)
    submittedRejectionRef.current = duel.lastRejection
    setPendingSwap(selectedId)
    // Submits duel:switch_decision via WS — the server owns the new active.
    actions.confirmSwap(selectedId)
  }

  return (
    <div className="pd-page">
      <div className="pd-glow-blob" style={{ left: '50%', top: '-10%', width: 700, height: 700, transform: 'translateX(-50%)' }} />

      <header className="pd-topbar">
        <span className="pd-logo pd-logo--sm">Poke-duels</span>
        <div className="pd-topbar__end">
          <span className="pd-meta">{player.nickname.toUpperCase() || 'ENTRENADOR'}</span>
          {mode === 'voluntary' && <CancelSwapButton onClick={() => navigate('/duel')} />}
        </div>
      </header>

      <main style={{ position: 'relative', zIndex: 2, padding: 32, maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1
            className="pd-title pd-title--lg"
            style={{
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              color: mode === 'forced' ? 'var(--pd-danger)' : 'var(--pd-blue-light)',
            }}
          >
            {mode === 'forced' ? 'SELECCIÓN OBLIGATORIA' : 'SELECCIONAR POKÉMON'}
          </h1>
          <p className="pd-meta" style={{ marginTop: 4 }}>
            {mode === 'forced'
              ? 'Tu pokémon se debilitó — elige un nuevo combatiente'
              : 'Elige qué Pokémon enviar al combate'}
          </p>
          {switchError && (
            <p role="status" className="pd-label" style={{ color: 'var(--pd-danger)', textAlign: 'center', margin: '16px 0 0' }}>
              CAMBIO RECHAZADO — {switchError.toUpperCase()}
            </p>
          )}
        </div>

        <BenchList pokemon={myPokemon} selectedId={selectedId} onSelect={handleSelect} />

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
          <ConfirmSwapButton disabled={!selectedId} onClick={handleConfirm} />
        </div>
      </main>
    </div>
  )
}

export default SwapScreen
export { BenchList, BenchPokemonCard, CancelSwapButton, ConfirmSwapButton }
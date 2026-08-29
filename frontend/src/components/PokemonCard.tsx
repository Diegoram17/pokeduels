import type { DuelPokemonState } from '../state/schema'
import { MAX_HP } from '../lib/duelBoard'
import HpBar from './HpBar'

export interface HudCardProps {
  pokemon: DuelPokemonState
  side: 'human' | 'rival'
}

/**
 * Shared duel HUD card (design A4): name / type / HP for the human or rival
 * side of the duel arena, emitting `data-testid="hud-{side}"` and a conditional
 * red right border on the rival card. Bench/catalog cards stay in their
 * screens (different DOM + testids).
 */
export function HudCard({ pokemon, side }: HudCardProps) {
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

export default HudCard
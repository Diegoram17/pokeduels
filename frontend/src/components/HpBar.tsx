import { MAX_HP } from '../lib/duelBoard'

export interface HpBarProps {
  hp: number
  max?: number
  ariaLabel?: string
}

/**
 * Shared HP progress bar (design A4): `role="progressbar"` with
 * `aria-valuenow/min/max`, inner `pd-hp-fill` tinted by thresholds
 * pct > 50 (high), pct > 20 (mid), else low. Defaults: max = MAX_HP,
 * ariaLabel = 'HP' (Swap passes `HP de ${name}`).
 */
export default function HpBar({ hp, max = MAX_HP, ariaLabel = 'HP' }: HpBarProps) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100))
  const tone =
    pct > 50 ? 'pd-hp-fill--high' : pct > 20 ? 'pd-hp-fill--mid' : 'pd-hp-fill--low'
  return (
    <div
      className="pd-hp-bar"
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={hp}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className={`pd-hp-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
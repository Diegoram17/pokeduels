import type { ReactNode } from 'react'
import NicknameBadge from './NicknameBadge'

export interface ScreenTopbarProps {
  nickname: string
  children?: ReactNode
}

/**
 * Shared sticky topbar (design A4, canonical 3-slot from Fase 7): nickname in
 * the left `.pd-topbar__start` slot, the Poke-duels logo absolutely centered
 * via `.pd-topbar__logo`, and optional children in the right `.pd-topbar__end`
 * slot. Unifies the 6 non-Login screens; the `.pd-topbar` header already
 * supplies the 64px height, blur, and sticky behavior.
 */
export default function ScreenTopbar({ nickname, children }: ScreenTopbarProps) {
  return (
    <header className="pd-topbar">
      <div className="pd-topbar__start">
        <NicknameBadge nickname={nickname} />
      </div>
      <span className="pd-logo pd-logo--sm pd-topbar__logo">Poke-duels</span>
      <div className="pd-topbar__end">{children}</div>
    </header>
  )
}
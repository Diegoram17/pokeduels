import type { ReactNode } from 'react'
import NicknameBadge from './NicknameBadge'

export interface ScreenTopbarProps {
  nickname: string
  children?: ReactNode
}

/**
 * Shared sticky topbar (design A4): logo + nickname badge + optional children
 * in the `.pd-topbar__end` slot. Unifies the 3 structurally identical sticky
 * topbars (Duel/Rank/Swap); lobby/draft/wait topbars keep their own unstyled
 * in-file headers with different layouts.
 */
export default function ScreenTopbar({ nickname, children }: ScreenTopbarProps) {
  return (
    <header className="pd-topbar">
      <span className="pd-logo pd-logo--sm">Poke-duels</span>
      <div className="pd-topbar__end">
        <NicknameBadge nickname={nickname} />
        {children}
      </div>
    </header>
  )
}
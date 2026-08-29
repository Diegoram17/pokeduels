import type { CSSProperties } from 'react'

export interface GlowBlobProps {
  style: CSSProperties
}

/**
 * Shared decorative glow blob (design A4): the absolutely-positioned radial
 * glow div used by 6 screens. Purely decorative — no testid, no ARIA.
 */
export default function GlowBlob({ style }: GlowBlobProps) {
  return <div className="pd-glow-blob" style={style} />
}
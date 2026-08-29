export interface NicknameBadgeProps {
  nickname: string
  'data-testid'?: string
}

/**
 * Shared nickname badge (design A4): uppercase nickname inside a `pd-meta`
 * span, falling back to `ENTRENADOR` for an empty nickname. Forwards an
 * optional `data-testid` (Lobby keeps `lobby-nickname`).
 */
export default function NicknameBadge({ nickname, 'data-testid': testId }: NicknameBadgeProps) {
  return (
    <span className="pd-meta" data-testid={testId}>
      {nickname.toUpperCase() || 'ENTRENADOR'}
    </span>
  )
}
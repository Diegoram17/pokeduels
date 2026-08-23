// Shared inline error banner + manual retry (design decision: one component
// reused across Login/Lobby/TeamSelect; role=alert + danger styling, no
// automatic redirects, no countdown/cooldown — decision #3, obs #188/#192).

export interface ErrorBannerProps {
  message: string
  onRetry: () => void
  retryLabel?: string
}

export default function ErrorBanner({ message, onRetry, retryLabel = 'REINTENTAR' }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="pd-meta"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--pd-space-3)',
        color: 'var(--pd-danger)',
        border: '1px solid rgba(238,21,21,.4)',
        background: 'rgba(238,21,21,.1)',
        borderRadius: 'var(--pd-radius-sm)',
        padding: 'var(--pd-space-2) var(--pd-space-3)',
        marginTop: 'var(--pd-space-2)',
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        className="pd-btn pd-btn--secondary pd-btn--sm"
        onClick={onRetry}
      >
        {retryLabel}
      </button>
    </div>
  )
}
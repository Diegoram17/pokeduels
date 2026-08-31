import { Navigate, useNavigate } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import ScreenTopbar from '../components/ScreenTopbar'
import GlowBlob from '../components/GlowBlob'
import { buildProvisionalRanking, type RankingEntry } from '../lib/ranking'

/**
 * Screen 7: Final Ranking (#10 PR 2). Server-driven podium: the authoritative
 * rows arrive via room:final_ranking and render verbatim; while a bracket room
 * is still open (finalRanking null), a provisional podium from the bracket +
 * finished duel renders instead — visually identical, so the swap to the
 * authoritative data on room:final_ranking is silent. "Jugar de nuevo" clears
 * the room/duel/tournament while keeping the nickname (ADR-0002).
 */

function PodiumRow({ entry }: { entry: RankingEntry }) {
  const isFirst = entry.rank === 1
  return (
    <div
      className={`podium-col${isFirst ? ' podium-col--first' : ''}`}
      data-testid="podium-row"
    >
      <div className="pd-card podium-card">
        <span className={`rank-chip rank-chip--${isFirst ? 'first' : 'standard'}`}>
          #{entry.rank}
        </span>

        <span
          className="pd-avatar podium-avatar"
          style={{
            width: isFirst ? 104 : 84,
            height: isFirst ? 104 : 84,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...(isFirst ? { borderColor: 'var(--pd-yellow)' } : {}),
          }}
        >
          <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 44, color: 'var(--pd-text-dim)' }}>
            person
          </span>
        </span>

        {isFirst && <span className="champion-badge">CAMPEÓN</span>}

        <h3
          className="podium-name"
          style={isFirst ? { fontSize: 22, color: 'var(--pd-yellow)' } : undefined}
        >
          {entry.name.toUpperCase()}
        </h3>

        <div className="stat-row">
          <div className="stat-item">
            <span>PUESTO</span>
            <strong>#{entry.rank}</strong>
          </div>
          <div className="stat-item">
            <span>TÍTULO</span>
            <strong>{entry.champion ? 'CAMPEÓN' : 'FINALISTA'}</strong>
          </div>
        </div>
      </div>

      <div className={`podium-base podium-base--${Math.min(entry.rank, 3)}`} />
    </div>
  )
}

function Podium({ entries }: { entries: RankingEntry[] }) {
  return (
    <div
      className="podium"
      data-testid="podium"
    >
      {entries.map((entry) => (
        <PodiumRow key={entry.rank} entry={entry} />
      ))}
    </div>
  )
}

function PlayAgainButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="pd-btn pd-btn--primary pd-btn--lg" onClick={onClick}>
      <span className="material-symbols-outlined" aria-hidden="true">
        replay
      </span>
      JUGAR DE NUEVO
      <span className="pd-btn__shine" />
    </button>
  )
}

function RankingScreen() {
  const [state, actions] = useMockState()
  const navigate = useNavigate()
  const room = state.room

  if (!room) {
    return <Navigate to="/lobby" replace />
  }

  const entries = state.finalRanking ?? buildProvisionalRanking(state)

  return (
    <div className="pd-page">
      <GlowBlob style={{ left: '50%', top: '10%', width: 800, height: 600, transform: 'translateX(-50%)' }} />
      <div className="pd-grid-perspective" />

      <ScreenTopbar nickname={state.player.nickname} />

      <main id="main-content" className="rank-main">
        <div className="rank-intro">
          <span className="rank-eyebrow pd-label">TORNEO DE ENTRENADORES</span>
          <h2 className="pd-title pd-title--lg">HALL DE LA FAMA</h2>
          <p className="pd-body" style={{ marginTop: 8 }}>
            Presentamos a los mejores entrenadores de la temporada.
          </p>
        </div>

        <Podium entries={entries} />

        <div style={{ marginTop: 48, zIndex: 20, position: 'relative' }}>
          <PlayAgainButton
            onClick={() => {
              actions.resetSession()
              navigate('/lobby')
            }}
          />
        </div>
      </main>
    </div>
  )
}

export default RankingScreen
export { Podium, PodiumRow, PlayAgainButton }
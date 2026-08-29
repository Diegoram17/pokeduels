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
      className="pd-card"
      data-testid="podium-row"
      style={{
        position: 'relative',
        width: 260,
        maxWidth: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '20px 16px 0',
        ...(isFirst
          ? { borderColor: 'var(--pd-yellow)', boxShadow: '0 0 20px rgba(255,203,5,.35), 0 26px 70px rgba(0,0,0,.72)' }
          : {}),
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: -14,
          padding: '4px 12px',
          borderRadius: 'var(--pd-radius-sm)',
          font: '700 16px/1 var(--pd-font-mono)',
          ...(isFirst
            ? { background: 'var(--pd-yellow)', color: '#1a1400' }
            : { background: 'rgba(120,180,255,.14)', color: 'var(--pd-text-meta)', border: '1px solid var(--pd-border-blue)' }),
        }}
      >
        #{entry.rank}
      </span>

      {isFirst && (
        <span
          style={{
            padding: '4px 8px',
            borderRadius: 'var(--pd-radius-sm)',
            marginBottom: 8,
            background: 'rgba(255,203,5,.14)',
            color: 'var(--pd-yellow)',
            border: '1px solid rgba(255,203,5,.4)',
            font: '700 11px/1 var(--pd-font-mono)',
            letterSpacing: '.12em',
            textTransform: 'uppercase',
          }}
        >
          CAMPEÓN
        </span>
      )}

      <span
        className="pd-avatar"
        style={{ width: isFirst ? 104 : 84, height: isFirst ? 104 : 84, margin: '12px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', ...(isFirst ? { borderColor: 'var(--pd-yellow)' } : {}) }}
      >
        <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 44, color: 'var(--pd-text-dim)' }}>
          person
        </span>
      </span>

      <h3
        style={{
          margin: 0,
          font: '800 18px/1.2 var(--pd-font-display)',
          color: '#fff',
          textTransform: 'uppercase',
          ...(isFirst ? { fontSize: 22, color: 'var(--pd-yellow)' } : {}),
        }}
      >
        {entry.name.toUpperCase()}
      </h3>

      <div
        style={{
          width: '100%',
          marginTop: 16,
          borderLeft: '1px solid var(--pd-border-blue-dim)',
          borderRight: '1px solid var(--pd-border-blue-dim)',
          borderTop: '1px solid var(--pd-border-blue-dim)',
          height: isFirst ? 160 : 110,
          ...(isFirst
            ? { background: 'linear-gradient(180deg, rgba(255,203,5,.14), rgba(9,16,40,.4))', borderColor: 'rgba(255,203,5,.4)' }
            : { background: 'linear-gradient(180deg, rgba(20,30,60,.6), rgba(9,16,40,.4))' }),
        }}
      />
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

      <main className="rank-main">
        <div style={{ textAlign: 'center', zIndex: 20, marginBottom: 24, maxWidth: 560 }}>
          <span
            className="pd-label"
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 'var(--pd-radius-sm)',
              background: 'rgba(255,203,5,.1)',
              border: '1px solid rgba(255,203,5,.35)',
              marginBottom: 12,
            }}
          >
            TORNEO DE ENTRENADORES
          </span>
          <h2 className="pd-title pd-title--lg" style={{ marginTop: 4 }}>
            HALL DE LA FAMA
          </h2>
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
import { Navigate, useNavigate } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import type { DuelSlot } from '../state/schema'
import {
  buildPlayerList,
  semifinalPairings,
  slotLabel,
} from '../lib/waitRoom'

/**
 * Screen 4: Wait Room. Reused for every duel slot of a tournament (semifinal
 * A/B, 3rd-place, final) and for 1v1. Renders the player list with bot
 * fillers, the current slot label, a semifinal mini bracket for tournaments,
 * and enter/leave navigation.
 */

function SlotLabel({ slot }: { slot: DuelSlot }) {
  return (
    <span className="pd-badge pd-badge--outline" data-testid="slot-label">
      {slot === '1v1' ? 'DUELO 1V1' : slotLabel(slot)}
    </span>
  )
}

function PlayerRow({ name, isBot }: { name: string; isBot: boolean }) {
  return (
    <div className={`player-row${isBot ? ' player-row--pending' : ' player-row--ready'}`}>
      <span className="avatar-fallback">
        <span className="material-symbols-outlined" aria-hidden="true">
          person
        </span>
      </span>
      <div className="info">
        <div className="name">{name}</div>
      </div>
      <span
        className={`material-symbols-outlined${isBot ? '' : ' pd-icon--fill'}`}
        aria-hidden="true"
        style={{ color: isBot ? 'var(--pd-text-meta)' : 'var(--pd-yellow)' }}
      >
        {isBot ? 'hourglass_empty' : 'check_circle'}
      </span>
    </div>
  )
}

function PlayerList({ players }: { players: ReturnType<typeof buildPlayerList> }) {
  return (
    <div className="player-list" data-testid="player-list">
      {players.map((entry) => (
        <PlayerRow key={entry.name} name={entry.name} isBot={entry.isBot} />
      ))}
    </div>
  )
}

function BracketMini({ players }: { players: string[] }) {
  const [semiA, semiB] = semifinalPairings(players)
  const semifinal = (
    first: [string, string],
    slotName: string,
  ) => (
    <div className="semis">
      <div className="pd-card pd-card--tight bracket-slot" style={{ borderLeft: '4px solid var(--pd-yellow)' }}>
        <span className="pid" style={{ background: 'rgba(255,203,5,.16)', color: 'var(--pd-yellow)' }}>
          {slotName}
        </span>
        <span className="pd-stat">{first[0]}</span>
      </div>
      <div className="pd-card pd-card--tight bracket-slot" style={{ opacity: 0.6 }}>
        <span className="pid" style={{ background: 'rgba(120,180,255,.1)', color: 'var(--pd-text-meta)' }}>
          {slotName === 'P1' ? 'P2' : 'P4'}
        </span>
        <span className="pd-stat" style={{ color: 'var(--pd-text-meta)' }}>
          {first[1]}
        </span>
      </div>
    </div>
  )
  return (
    <section className="pd-card bracket-section" aria-label="CUADRO / LLAVES">
      <div className="bracket-head">
        <h2 className="pd-title" style={{ color: 'var(--pd-blue-light)' }}>
          CUADRO / LLAVES
        </h2>
        <span className="pd-badge pd-badge--outline" style={{ color: 'var(--pd-text-meta)', borderColor: 'var(--pd-border-blue)' }}>
          RONDA DE 4
        </span>
      </div>
      <div className="bracket-wrap">
        <div className="bracket-row">
          {semifinal(semiA, 'P1')}
          {semifinal(semiB, 'P3')}
          <div className="connections">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              <path d="M 0 15 L 50 15 L 50 50 L 100 50" fill="none" stroke="#ffcb05" strokeWidth="2" />
              <path d="M 0 85 L 50 85 L 50 50" fill="none" stroke="rgba(120,180,255,.35)" strokeWidth="2" />
            </svg>
          </div>
          <div className="final-slot">
            <div className="pd-card" style={{ borderColor: 'var(--pd-yellow)' }}>
              <span className="pd-label" style={{ display: 'block', marginBottom: 'var(--pd-space-2)' }}>
                Gran Final
              </span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--pd-space-3)' }}>
                <span className="pd-stat">GANADOR A</span>
                <span className="pd-meta">VS</span>
                <span className="pd-stat" style={{ color: 'var(--pd-text-meta)' }}>
                  GANADOR B
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function EnterDuelButton({ slot }: { slot: DuelSlot }) {
  const [, actions] = useMockState()
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="pd-btn pd-btn--primary"
      onClick={() => {
        actions.enterDuel(slot)
        navigate('/duel')
      }}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        sports_esports
      </span>
      ENTRAR AL COMBATE
      <span className="pd-btn__shine" />
    </button>
  )
}

function LeaveRoomButton() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="pd-btn pd-btn--ghost pd-btn--block"
      onClick={() => navigate('/lobby')}
    >
      SALIR DE LA SALA
    </button>
  )
}

function WaitRoomScreen() {
  const [state] = useMockState()
  const navigate = useNavigate()
  const room = state.room

  if (!room) {
    return <Navigate to="/lobby" replace />
  }

  const isTournament = room.mode === 'tournament'
  const slot: DuelSlot = isTournament && state.tournament
    ? state.tournament.activeSlot
    : '1v1'
  const players = buildPlayerList(room)
  const playerNames = players.map((entry) => entry.name)

  return (
    <div className="pd-page wait-shell">
      <div className="pd-glow-blob" style={{ right: '-6%', top: '20%', width: 520, height: 520 }} />

      <header className="wait-topbar">
        <span className="pd-logo pd-logo--sm">Poke-duels</span>
        <span className="pd-meta">{state.player.nickname.toUpperCase() || 'ENTRENADOR'}</span>
        <span className="pd-meta wifi-status">
          <span className="material-symbols-outlined pd-icon--fill" aria-hidden="true" style={{ fontSize: 16, color: 'var(--pd-yellow-mid)' }}>
            wifi
          </span>
          Conectado
        </span>
      </header>

      <main className="wait-main">
        <aside className="pd-card wait-side">
          <div className="wait-side-head">
            <h2 className="pd-title" style={{ color: 'var(--pd-blue-light)' }}>
              SALA DE ESPERA
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pd-space-2)' }}>
              <SlotLabel slot={slot} />
              <span className="pd-stat" style={{ background: 'rgba(6,12,30,.6)', padding: 'var(--pd-space-1) var(--pd-space-2)', borderRadius: 'var(--pd-radius-sm)' }}>
                {players.length} / {room.maxPlayers}
              </span>
            </div>
          </div>

          <PlayerList players={players} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-3)' }}>
            <LeaveRoomButton />
            <button
              type="button"
              className="pd-btn pd-btn--secondary pd-btn--block"
              onClick={() => navigate('/team-select')}
            >
              CAMBIAR EQUIPO
            </button>
          </div>
        </aside>

        {isTournament && <BracketMini players={playerNames} />}

        <div style={{ display: 'flex', justifyContent: 'flex-end', flex: 'none' }}>
          <EnterDuelButton slot={slot} />
        </div>
      </main>
    </div>
  )
}

export default WaitRoomScreen
export { SlotLabel, PlayerList, PlayerRow, BracketMini, EnterDuelButton, LeaveRoomButton }
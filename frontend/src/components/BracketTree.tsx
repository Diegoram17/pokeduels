import type { RoomState, TournamentSlot, TournamentState } from '../state/schema'
import { slotLabel } from '../lib/waitRoom'

export interface BracketTreeProps {
  bracket: TournamentState['bracket']
  room: RoomState
}

/** Semi slot → pid chip mapping (Prototipos/4: P1 top semi, P2 bottom semi). */
const SEMI_SLOTS: { slot: TournamentSlot; pid: string }[] = [
  { slot: 'semiA', pid: 'P1' },
  { slot: 'semiB', pid: 'P2' },
]

/**
 * 4-player tournament bracket connector tree, verbatim from
 * Prototipos/4.Sala_de_espera.html: `.bracket-wrap > .bracket-row >
 * (.semis > 2×.bracket-slot) + .connections(<svg viewBox="0 0 100 100"
 * preserveAspectRatio="none">) + .final-slot`, with `thirdPlace` as a dimmed
 * caption row beneath the tree (the prototype has no node for it). Slots map
 * semiA → P1 position, semiB → P2 position, final → "Gran Final"; an unfilled
 * slot renders "TBD" and is dimmed (opacity .6, prototype idiom). 1v1 rooms
 * render nothing — the WaitRoom additionally gates on `state.tournament`.
 */
export default function BracketTree({ bracket, room }: BracketTreeProps) {
  if (room.maxPlayers !== 4) return null

  const nameOf = (id: string | number): string =>
    room.players.find((p) => p.playerId === String(id))?.nickname ?? String(id)

  const semiA = bracket.semiA
  const semiB = bracket.semiB
  const final = bracket.final
  const third = bracket.thirdPlace

  // Winner-path highlight: a semi's connector turns yellow once one of its
  // players appears in the resolved final pairing; both stay dimmed while the
  // final is still undecided.
  const semiPlayers = (pairing: TournamentState['bracket'][TournamentSlot]): string[] =>
    pairing ? [pairing.playerA, pairing.playerB] : []
  const finalPlayers = final ? [final.playerA, final.playerB] : []
  const semiAWon = final ? semiPlayers(semiA).some((id) => finalPlayers.includes(id)) : false
  const semiBWon = final ? semiPlayers(semiB).some((id) => finalPlayers.includes(id)) : false

  return (
    <section className="pd-card bracket-section" aria-label="CUADRO / LLAVES">
      <div className="bracket-head">
        <h2 className="pd-title" style={{ color: 'var(--pd-blue-light)' }}>
          CUADRO / LLAVES
        </h2>
        <span
          className="pd-badge pd-badge--outline"
          style={{ color: 'var(--pd-text-meta)', borderColor: 'var(--pd-border-blue)' }}
        >
          RONDA DE 4
        </span>
      </div>

      <div className="bracket-wrap">
        <div className="bracket-row">
          <div className="semis">
            {SEMI_SLOTS.map(({ slot, pid }) => {
              const pairing = bracket[slot]
              const pending = !pairing
              return (
                <div
                  key={slot}
                  className="pd-card pd-card--tight bracket-slot"
                  style={pending ? { opacity: 0.6 } : { borderLeft: '4px solid var(--pd-yellow)' }}
                >
                  <span
                    className="pid"
                    style={
                      pending
                        ? { background: 'rgba(120,180,255,.1)', color: 'var(--pd-text-meta)' }
                        : { background: 'rgba(255,203,5,.16)', color: 'var(--pd-yellow)' }
                    }
                  >
                    {pid}
                  </span>
                  <span className="pd-meta">{slotLabel(slot)}</span>
                  <span className="pd-stat">{pairing ? nameOf(pairing.playerA) : 'TBD'}</span>
                  <span className="pd-meta">VS</span>
                  <span className="pd-stat">{pairing ? nameOf(pairing.playerB) : 'TBD'}</span>
                </div>
              )
            })}
          </div>

          <div className="connections">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            >
              <path
                d="M 0 15 L 50 15 L 50 50 L 100 50"
                fill="none"
                stroke={semiAWon ? '#ffcb05' : 'rgba(120,180,255,.35)'}
                strokeWidth="2"
              />
              <path
                d="M 0 85 L 50 85 L 50 50"
                fill="none"
                stroke={semiBWon ? '#ffcb05' : 'rgba(120,180,255,.35)'}
                strokeWidth="2"
              />
            </svg>
          </div>

          <div className="final-slot">
            <div
              className="pd-card"
              style={final ? { borderColor: 'var(--pd-yellow)' } : { opacity: 0.6 }}
            >
              <span className="pd-label" style={{ display: 'block', marginBottom: 'var(--pd-space-2)' }}>
                Gran Final
              </span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--pd-space-3)' }}>
                <span className="pd-stat">{final ? nameOf(final.playerA) : 'TBD'}</span>
                <span className="pd-meta">VS</span>
                <span className="pd-stat" style={{ color: 'var(--pd-text-meta)' }}>
                  {final ? nameOf(final.playerB) : 'TBD'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 3rd place: dimmed caption row beneath the tree (no prototype node). */}
        <div className="bracket-third" style={{ opacity: 0.6 }}>
          <span className="pd-meta">{slotLabel('thirdPlace')}</span>
          <span className="pd-stat">{third ? nameOf(third.playerA) : 'TBD'}</span>
          <span className="pd-meta">VS</span>
          <span className="pd-stat">{third ? nameOf(third.playerB) : 'TBD'}</span>
        </div>
      </div>
    </section>
  )
}
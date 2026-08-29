import { Navigate, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useMockState } from '../state/useMockState'
import NicknameBadge from '../components/NicknameBadge'
import GlowBlob from '../components/GlowBlob'
import type { DuelSlot, RoomState, TournamentSlot, TournamentState } from '../state/schema'
import { deriveDuelSlot } from '../state/store'
import { buildPlayerList, slotLabel } from '../lib/waitRoom'
import { roomMode, roomModeLabel } from '../lib/rooms'
import { createBot, removeBot, describeApiError } from '../lib/api'

/**
 * Screen 4: Wait Room (#10 PR 2). Renders the player list, a real bracket
 * projection from tournament:bracket broadcasts, the pending-duel entry button
 * (keyed on pendingDuelId), and the 1v1 PostDuelRematchPanel when a 1v1 duel
 * finished without the room closing (both seats reset to not-ready; each
 * player re-readies via the existing room:ready pipeline or leaves).
 */

function SlotLabel({ slot }: { slot: DuelSlot }) {
  return (
    <span className="pd-badge pd-badge--outline" data-testid="slot-label">
      {slot === '1v1' ? 'DUELO 1V1' : slotLabel(slot)}
    </span>
  )
}

function PlayerRow({ 
  name, 
  isBot,
  ready,
  playerId,
  roomCode,
  onBotRemoved 
}: { 
  name: string
  isBot: boolean
  ready: boolean
  playerId?: string
  roomCode?: string
  onBotRemoved?: () => void
}) {
  const [removing, setRemoving] = useState(false)

  async function handleRemoveBot() {
    if (!roomCode || !playerId || !onBotRemoved) return
    setRemoving(true)
    try {
      await removeBot(roomCode, playerId)
      onBotRemoved()
    } catch (err) {
      console.error('Failed to remove bot:', err)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div>
      <span>
        <span className="material-symbols-outlined" aria-hidden="true">
          {isBot ? 'smart_toy' : 'person'}
        </span>
      </span>
      <div>
        <div>{name}</div>
      </div>
      {isBot && roomCode && playerId ? (
        <button
          type="button"
          onClick={handleRemoveBot}
          disabled={removing}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: removing ? 'wait' : 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
          }}
          title="Quitar bot"
        >
          <span
            className="material-symbols-outlined"
            aria-hidden="true"
            style={{ color: 'var(--pd-danger)', fontSize: 20 }}
          >
            {removing ? 'hourglass_empty' : 'close'}
          </span>
        </button>
      ) : ready ? (
        <span
          className="material-symbols-outlined pd-icon--fill"
          aria-hidden="true"
          style={{ color: 'var(--pd-yellow)' }}
        >
          check_circle
        </span>
      ) : null}
    </div>
  )
}

function PlayerList({ 
  players,
  roomCode,
  onBotRemoved 
}: { 
  players: ReturnType<typeof buildPlayerList>
  roomCode?: string
  onBotRemoved?: () => void
}) {
  return (
    <div data-testid="player-list">
      {players.map((entry) => (
        <PlayerRow 
          key={entry.playerId || entry.name} 
          name={entry.name} 
          isBot={entry.isBot}
          ready={entry.ready}
          playerId={entry.playerId}
          roomCode={roomCode}
          onBotRemoved={onBotRemoved}
        />
      ))}
    </div>
  )
}

const SLOT_ORDER: TournamentSlot[] = ['semiA', 'semiB', 'thirdPlace', 'final']

/**
 * Real bracket mini (#10): rendered exclusively from the server-pushed
 * tournament:bracket projection. The bracket carries numeric player ids, so
 * names resolve through the room roster (falling back to the raw id).
 */
function BracketMini({
  bracket,
  room,
}: {
  bracket: TournamentState['bracket']
  room: RoomState
}) {
  const nameOf = (id: string): string =>
    room.players.find((p) => p.playerId === id)?.nickname ?? id
  return (
    <section className="pd-card" aria-label="CUADRO / LLAVES">
      <div>
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
        {SLOT_ORDER.map((slot) => {
          const pairing = bracket[slot]
          return (
            <div key={slot} className="pd-card pd-card--tight">
              <span style={{ color: 'var(--pd-yellow)' }}>
                {slotLabel(slot)}
              </span>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span className="pd-stat">{pairing ? nameOf(pairing.playerA) : 'TBD'}</span>
                <span className="pd-meta">VS</span>
                <span className="pd-stat">{pairing ? nameOf(pairing.playerB) : 'TBD'}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Enter button for a server-announced duel: renders whenever pendingDuelId is
 * non-null and joins it via duel:join (design decision: explicit-click gate).
 */
function EnterDuelButton() {
  const [state, actions] = useMockState()
  const navigate = useNavigate()
  const pendingDuelId = state.pendingDuelId
  const duel = state.duel
  // Navigate to /duel only once the join the player explicitly requested has
  // actually resolved (duel:state). Without the guard, any duel:state landing
  // while on the wait-room would yank the user off it — breaking the
  // explicit-click gate and the tournament wait/round view (which shows the
  // live slot label from a duel already in state).
  const requestedDuelIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (requestedDuelIdRef.current && duel?.duelId === requestedDuelIdRef.current) {
      navigate('/duel')
    }
  }, [duel, navigate])

  if (pendingDuelId == null) return null
  return (
    <button
      type="button"
      className="pd-btn pd-btn--primary"
      onClick={() => {
        requestedDuelIdRef.current = pendingDuelId
        actions.joinDuel(pendingDuelId)
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

/**
 * Bot management controls: add a bot to the room (one per click).
 */
function BotManager({ 
  room,
  onBotAdded 
}: { 
  room: RoomState
  onBotAdded: () => void 
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentPlayers = room.players.length
  const emptySlots = room.maxPlayers - currentPlayers
  const hasEmptySlots = emptySlots > 0

  async function handleAddBots() {
    if (!hasEmptySlots) return
    setAdding(true)
    setError(null)
    try {
      await createBot(room.code)
    } catch (err) {
      setError(describeApiError(err))
    } finally {
      // Refresh even on failure — the request may have partially succeeded.
      onBotAdded()
      setAdding(false)
    }
  }

  if (!hasEmptySlots) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-2)' }}>
      <button
        type="button"
        className="pd-btn pd-btn--secondary pd-btn--block"
        onClick={handleAddBots}
        disabled={adding}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--pd-space-2)' }}
      >
        <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 20 }}>
          smart_toy
        </span>
        {adding ? 'AGREGANDO...' : 'AGREGAR BOT'}
      </button>
      {error && (
        <p role="alert" className="pd-meta" style={{ color: 'var(--pd-danger)', margin: 0, textAlign: 'center' }}>
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * 1v1 post-duel re-ready (#10): shown when a 1v1 duel finished and the room
 * stayed in_progress (pendingDuelId null means no rematch has bootstrapped
 * yet). REVANCHA re-readies through the existing room:ready pipeline; SALIR
 * reuses the shared LeaveRoomButton (design: "'SALIR' (existing
 * LeaveRoomButton)").
 */
function PostDuelRematchPanel({
  won,
  onRematch,
}: {
  won: boolean
  onRematch: () => void
}) {
  return (
    <div className="pd-card" data-testid="rematch-panel" style={{ padding: 24, textAlign: 'center' }}>
      <h2 className="pd-title" style={{ margin: 0, color: won ? 'var(--pd-yellow)' : 'var(--pd-text-meta)' }}>
        {won ? '¡GANASTE EL DUELO!' : 'PERDISTE EL DUELO'}
      </h2>
      <p className="pd-body" style={{ margin: '8px 0 20px' }}>
        La sala sigue abierta. ¿Revancha o salir?
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button type="button" className="pd-btn pd-btn--primary pd-btn--block" onClick={onRematch}>
          REVANCHA
        </button>
        <LeaveRoomButton />
      </div>
    </div>
  )
}

function WaitRoomScreen() {
  const [state, actions] = useMockState()
  const navigate = useNavigate()
  const room = state.room
  const [, forceUpdate] = useState(0)

  if (!room) {
    return <Navigate to="/lobby" replace />
  }

  const isTournament = roomMode(room.maxPlayers) === 'tournament'
  const liveSlot = state.duel ? deriveDuelSlot(state.duel.duelId, state.tournament) : null
  const players = buildPlayerList(room)

  const showRematch =
    !isTournament && state.duel?.phase === 'finished' && state.pendingDuelId === null
  const won = state.duel?.winnerId === state.player.playerId

  // Find current player's ready state from the room roster
  const currentPlayer = room.players.find((p) => p.playerId === state.player.playerId)
  const isReady = currentPlayer?.ready ?? false

  // Force re-render when bots are added/removed (room state updates via WS)
  const handleBotChange = () => {
    forceUpdate(n => n + 1)
  }

  return (
    <div className="pd-page">
      <GlowBlob style={{ right: '-6%', top: '20%', width: 520, height: 520 }} />

      <header>
        <span className="pd-logo pd-logo--sm">Poke-duels</span>
        <NicknameBadge nickname={state.player.nickname} />
        <span className="pd-meta">
          <span
            className="material-symbols-outlined pd-icon--fill"
            aria-hidden="true"
            style={{ fontSize: 16, color: 'var(--pd-yellow-mid)' }}
          >
            wifi
          </span>
          Conectado
        </span>
      </header>

      <main id="main-content">
        <aside className="pd-card">
          <div>
            <h2 className="pd-title" style={{ color: 'var(--pd-blue-light)' }}>
              SALA DE ESPERA
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pd-space-2)' }}>
              {liveSlot ? (
                <SlotLabel slot={liveSlot} />
              ) : (
                <span className="pd-badge pd-badge--outline" data-testid="slot-label">
                  {roomModeLabel(roomMode(room.maxPlayers))}
                </span>
              )}
              <span
                className="pd-stat"
                style={{
                  background: 'rgba(6,12,30,.6)',
                  padding: 'var(--pd-space-1) var(--pd-space-2)',
                  borderRadius: 'var(--pd-radius-sm)',
                }}
              >
                {players.length} / {room.maxPlayers}
              </span>
            </div>
          </div>

          <PlayerList 
            players={players} 
            roomCode={room.code}
            onBotRemoved={handleBotChange}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-3)' }}>
            <BotManager room={room} onBotAdded={handleBotChange} />
            <button
              type="button"
              className="pd-btn pd-btn--block"
              onClick={() => actions.setReady(!isReady)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--pd-space-2)',
                background: isReady ? 'var(--pd-success, #22c55e)' : undefined,
                borderColor: isReady ? 'var(--pd-success, #22c55e)' : undefined,
              }}
            >
              <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 20 }}>
                {isReady ? 'check_circle' : 'radio_button_unchecked'}
              </span>
              {isReady ? 'LISTO ✓' : 'LISTO'}
            </button>
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

        {isTournament && state.tournament && (
          <BracketMini bracket={state.tournament.bracket} room={room} />
        )}

        {showRematch ? (
          <div style={{ display: 'flex', justifyContent: 'center', flex: 'none' }}>
            <PostDuelRematchPanel
              won={won}
              onRematch={() => actions.setReady(true)}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', flex: 'none' }}>
            <EnterDuelButton />
          </div>
        )}
      </main>
    </div>
  )
}

export default WaitRoomScreen
export {
  SlotLabel,
  PlayerList,
  PlayerRow,
  BracketMini,
  EnterDuelButton,
  LeaveRoomButton,
  BotManager,
  PostDuelRematchPanel,
}
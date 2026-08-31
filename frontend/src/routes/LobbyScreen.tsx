import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import {
  listRooms,
  createRoom,
  joinRoomByCode,
  describeApiError,
  type RoomSummary,
} from '../lib/api'
import {
  normalizeRoomCode,
  roomMode,
  roomModeLabel,
  roomStatusLabel,
} from '../lib/rooms'
import { onSocketEvent } from '../lib/socket'
import { validateNickname } from '../lib/validation'
import ErrorBanner from '../components/ErrorBanner'
import ScreenTopbar from '../components/ScreenTopbar'
import RulesModal from '../components/RulesModal'
import GlowBlob from '../components/GlowBlob'

/**
 * Screen 2: Lobby. Waiting rooms listed from GET /api/rooms, create room
 * (mode + maxPlayers) and join-by-code via REST, and a "Cambiar apodo"
 * control. After a successful create/join the room shell is stored and the
 * app proceeds to team select; errors render an inline banner with manual
 * retry (no automatic redirects).
 */

function WaitingRoomCard({
  room,
  onJoin,
}: {
  room: RoomSummary
  onJoin: (code: string) => Promise<void>
}) {
  const mode = roomMode(room.max_players)
  const full = room.player_count >= room.max_players
  const joinable = room.status === 'waiting' && !full
  return (
    <div
      className={`pd-card room-card${full ? ' room-card--full' : ''}`}
      data-testid="room-card"
    >
      <div className="room-card-top">
        <div>
          <span className="room-code" data-testid="room-code">
            #{room.code}
          </span>
          <span className="pd-meta room-mode-label">{roomModeLabel(mode)}</span>
        </div>
        <span className={`pd-badge pd-badge--${room.status}`}>
          {roomStatusLabel(room.status)}
        </span>
      </div>
      <div className="pd-divider" />
      <div className="room-card-foot">
        <div className="avatar-stack">
          {Array.from({ length: room.player_count }).map((_, i) => (
            <span className="pd-avatar" key={i}>
              <span className="material-symbols-outlined" aria-hidden="true">
                person
              </span>
            </span>
          ))}
          {Array.from({ length: Math.max(0, room.max_players - room.player_count) }).map((_, i) => (
            <span className="avatar-slot-empty" key={i}>
              <span className="material-symbols-outlined" aria-hidden="true">
                add
              </span>
            </span>
          ))}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="pd-stat" style={{ display: 'block' }}>
            {room.player_count}/{room.max_players}
          </span>
          <span className="pd-meta">Jugadores</span>
        </div>
      </div>
      <div className="pd-divider" />
      <button
        type="button"
        className="pd-btn pd-btn--primary pd-btn--block"
        disabled={!joinable}
        onClick={() => onJoin(room.code)}
      >
        {full ? 'SALA LLENA' : 'UNIRSE A LA SALA'}
      </button>
    </div>
  )
}

function RoomList({
  rooms,
  onJoin,
}: {
  rooms: RoomSummary[]
  onJoin: (code: string) => Promise<void>
}) {
  return (
    <div className="room-grid">
      {rooms.length === 0 ? (
        <div className="pd-card room-card room-card--empty">
          <span className="pd-meta">No hay salas esperando entrenadores</span>
        </div>
      ) : (
        rooms.map((room) => (
          <WaitingRoomCard key={room.id} room={room} onJoin={onJoin} />
        ))
      )}
    </div>
  )
}

function CreateRoomForm({ onCreated }: { onCreated: (maxPlayers: 2 | 4) => Promise<void> }) {
  const [pending, setPending] = useState(false)

  async function create(maxPlayers: 2 | 4) {
    setPending(true)
    try {
      await onCreated(maxPlayers)
    } finally {
      setPending(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-3)' }}>
      <button
        type="button"
        className="create-room-btn"
        style={{ border: '1px solid var(--pd-border-blue-soft)' }}
        onClick={() => create(2)}
        disabled={pending}
      >
        <span>
          <span className="create-room-btn__title">Duelo Individual (1v1)</span>
          <span className="create-room-btn__desc">Duelo directo a 1 ronda</span>
        </span>
        <span
          className="create-room-btn__icon"
          style={{ background: 'rgba(90,170,255,.14)', border: '1px solid var(--pd-border-blue-soft)', color: 'var(--pd-blue-light)' }}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            person
          </span>
        </span>
      </button>
      <button
        type="button"
        className="create-room-btn"
        style={{ border: '1px solid rgba(238,21,21,.35)' }}
        onClick={() => create(4)}
        disabled={pending}
      >
        <span>
          <span className="create-room-btn__title">Torneo de Entrenadores (4 Jugadores)</span>
          <span className="create-room-btn__desc">Torneo eliminatorio con semifinal y final</span>
        </span>
        <span
          className="create-room-btn__icon"
          style={{ background: 'rgba(238,21,21,.14)', border: '1px solid rgba(238,21,21,.35)', color: 'var(--pd-danger)' }}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            group
          </span>
        </span>
      </button>
    </div>
  )
}

function JoinByCodeForm({ onJoin }: { onJoin: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      await onJoin(normalizeRoomCode(code))
      setCode('')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="quick-join-wrap">
        <input
          type="text"
          className="pd-input"
          placeholder="Código de Sala..."
          aria-label="Código de sala"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button type="submit" className="quick-join-submit" aria-label="Unirse" disabled={pending}>
          <span className="material-symbols-outlined" aria-hidden="true">
            arrow_forward
          </span>
        </button>
      </div>
    </form>
  )
}

function ChangeNicknameControl() {
  const [, actions] = useMockState()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = validateNickname(value)
    if (message) {
      setError(message)
      return
    }
    actions.setNickname(value.trim())
    setEditing(false)
    setValue('')
    setError(null)
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="pd-btn pd-btn--ghost"
        onClick={() => setEditing(true)}
      >
        CAMBIAR APODO
      </button>
    )
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', alignItems: 'center', gap: 'var(--pd-space-2)' }}>
      <input
        type="text"
        className="pd-input"
        placeholder="Nuevo apodo"
        aria-label="Nuevo apodo"
        value={value}
        autoFocus
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        style={{ width: 160 }}
      />
      <button type="submit" className="pd-btn pd-btn--secondary">
        Guardar
      </button>
      {error && (
        <span role="alert" className="pd-meta" style={{ color: 'var(--pd-danger)' }}>
          {error}
        </span>
      )}
    </form>
  )
}

function LobbyScreen() {
  const [state, actions] = useMockState()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [wsError, setWsError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const loadRooms = useCallback(() => {
    setError(null)
    setIsLoading(true)
    listRooms()
      .then(setRooms)
      .catch((err: unknown) => setError(describeApiError(err)))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    loadRooms()
  }, [loadRooms])

  // Generic WS disconnect/reconnect banner (decision #1, obs #192): no
  // countdown of the backend grace window, manual retry only — the roster
  // restores from the next room:state automatically on reconnect.
  // connect_error (session rejected or handshake failure, spec "Expired/
  // Invalid Session Handling") routes through the same inline banner, no
  // exceptions — same behavior as disconnect, no auto-redirect.
  useEffect(() => {
    const offDisconnect = onSocketEvent('disconnect', () => {
      setWsError('Se perdió la conexión con el servidor')
    })
    const offConnectError = onSocketEvent('connect_error', () => {
      setWsError('No se pudo conectar con el servidor')
    })
    const offConnect = onSocketEvent('connect', () => {
      setWsError(null)
    })
    return () => {
      offDisconnect()
      offConnectError()
      offConnect()
    }
  }, [])

  async function handleCreated(maxPlayers: 2 | 4) {
    setError(null)
    try {
      const room = await createRoom(maxPlayers)
      actions.receiveRoomShell({
        code: room.code,
        maxPlayers,
        status: room.status,
      })
      // Establish the WS room subscription so the live roster arrives via
      // room:state (design data flow: roomShellReceived → room:join).
      actions.joinRoomWs(room.code)
      navigate('/team-select')
    } catch (err) {
      setError(describeApiError(err))
    }
  }

  async function handleJoin(code: string) {
    setError(null)
    try {
      const room = await joinRoomByCode(code, state.player.nickname)
      actions.receiveRoomShell({
        code: room.code,
        maxPlayers: room.max_players,
        status: room.status,
      })
      actions.joinRoomWs(room.code)
      navigate('/team-select')
    } catch (err) {
      setError(describeApiError(err))
    }
  }

  return (
    <div className="pd-page lobby-shell">
      <GlowBlob style={{ right: '-8%', top: '10%', width: 600, height: 600 }} />
      <div className="pd-grid-perspective" />

      <ScreenTopbar nickname={state.player.nickname}>
        <ChangeNicknameControl />
        <button type="button" className="pd-btn pd-btn--secondary pd-btn--sm" onClick={() => setRulesOpen(true)}>
          Reglas del juego
        </button>
        <button type="button" className="pd-btn pd-btn--sm" onClick={() => navigate('/')}>
          Volver al inicio
        </button>
      </ScreenTopbar>

      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}

      <div className="lobby-body">
        <main id="main-content" className="lobby-main">
          <div className="lobby-header-row">
            <div>
              <h1 className="pd-title pd-title--lg" style={{ textTransform: 'uppercase' }}>
                SALAS DE BATALLA
              </h1>
              <p className="pd-body" style={{ marginTop: 'var(--pd-space-2)', maxWidth: 520 }}>
                ¡Únete a un duelo listo o crea tu propia sala para desafiar a otros entrenadores!
              </p>
            </div>
          </div>

          {wsError && <ErrorBanner message={wsError} onRetry={() => {}} />}
          {error && <ErrorBanner message={error} onRetry={loadRooms} />}
          {isLoading && !error ? (
            <div role="status" aria-label="Cargando salas" aria-busy="true">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="pd-sprite-slot" aria-hidden="true" />
              ))}
            </div>
          ) : !error ? (
            <RoomList rooms={rooms} onJoin={handleJoin} />
          ) : null}
        </main>

        <aside className="pd-card lobby-side">
          <div>
            <h3 className="pd-title side-heading">
              <span className="material-symbols-outlined" aria-hidden="true" style={{ color: 'var(--pd-yellow)' }}>
                bolt
              </span>
              Unirse con Código
            </h3>
            <JoinByCodeForm onJoin={handleJoin} />
          </div>

          <div className="pd-divider" />

          <div>
            <h3 className="pd-title" style={{ marginBottom: 'var(--pd-space-3)' }}>
              Crear Sala
            </h3>
            <CreateRoomForm onCreated={handleCreated} />
          </div>
        </aside>
      </div>
    </div>
  )
}

export default LobbyScreen
export { WaitingRoomCard, RoomList, CreateRoomForm, JoinByCodeForm, ChangeNicknameControl }
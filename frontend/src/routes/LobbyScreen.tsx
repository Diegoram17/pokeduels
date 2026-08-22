import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import type { RoomMode, RoomState } from '../state/schema'
import {
  matchesRoomCode,
  roomModeLabel,
  roomStatusLabel,
} from '../lib/rooms'
import { validateNickname } from '../lib/validation'

/**
 * Screen 2: Lobby. Room list from mock state, create room (mode + maxPlayers),
 * join by code, and a "Cambiar apodo" control that propagates the nickname
 * to every later screen through mock state.
 */

function RoomCard({ room }: { room: RoomState }) {
  const filled = room.players.length
  const emptySlots = Math.max(0, room.maxPlayers - filled)
  return (
    <div className="pd-card room-card">
      <div className="room-card-top">
        <div>
          <span className="room-code" data-testid="room-code">
            #{room.code}
          </span>
          <span className="pd-meta room-mode-label">{roomModeLabel(room.mode)}</span>
        </div>
        <span className={`pd-badge pd-badge--${room.status}`}>
          {roomStatusLabel(room.status)}
        </span>
      </div>
      <div className="pd-divider" />
      <div className="room-card-foot">
        <div className="avatar-stack">
          {room.players.map((name) => (
            <span className="pd-avatar" key={name} title={name}>
              <span className="material-symbols-outlined" aria-hidden="true">
                person
              </span>
            </span>
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <span className="avatar-slot-empty" key={i}>
              <span className="material-symbols-outlined" aria-hidden="true">
                add
              </span>
            </span>
          ))}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="pd-stat" style={{ display: 'block' }}>
            {filled}/{room.maxPlayers}
          </span>
          <span className="pd-meta">Jugadores</span>
        </div>
      </div>
    </div>
  )
}

function RoomList({ room }: { room: RoomState | null }) {
  if (!room) {
    return (
      <div className="pd-card room-card room-card--empty">
        <span className="pd-meta">Buscando...</span>
      </div>
    )
  }
  return <RoomCard room={room} />
}

function CreateRoomForm() {
  const [, actions] = useMockState()
  const navigate = useNavigate()

  function create(mode: RoomMode, maxPlayers: 2 | 4) {
    actions.createRoom(mode, maxPlayers)
    navigate('/team-select')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-3)' }}>
      <button
        type="button"
        className="create-room-btn"
        style={{ border: '1px solid var(--pd-border-blue-soft)' }}
        onClick={() => create('1v1', 2)}
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
        onClick={() => create('tournament', 4)}
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

function JoinByCodeForm() {
  const [state, actions] = useMockState()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!matchesRoomCode(code, state.room)) {
      setError('No se encontró una sala con ese código')
      return
    }
    actions.joinRoom(code)
    navigate('/team-select')
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="quick-join-wrap">
        <input
          type="text"
          className="pd-input"
          placeholder="Código de Sala..."
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
            setError(null)
          }}
        />
        <button type="submit" className="quick-join-submit" aria-label="Unirse">
          <span className="material-symbols-outlined" aria-hidden="true">
            arrow_forward
          </span>
        </button>
      </div>
      {error && (
        <p role="alert" className="pd-meta" style={{ color: 'var(--pd-danger)', marginTop: 'var(--pd-space-2)' }}>
          {error}
        </p>
      )}
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
  const [state] = useMockState()
  return (
    <div className="pd-page lobby-shell">
      <div className="pd-glow-blob" style={{ right: '-8%', top: '10%', width: 600, height: 600 }} />
      <div className="pd-grid-perspective" />

      <header className="lobby-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pd-space-2)' }}>
          <span className="pd-pokeball" />
          <span className="pd-logo pd-logo--sm">Poke-duels</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pd-space-4)' }}>
          <span className="pd-meta" data-testid="lobby-nickname">
            {state.player.nickname.toUpperCase() || 'ENTRENADOR'}
          </span>
          <ChangeNicknameControl />
        </div>
      </header>

      <div className="lobby-body">
        <main className="lobby-main">
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

          <div className="room-grid">
            <RoomList room={state.room} />
          </div>
        </main>

        <aside className="pd-card lobby-side">
          <div>
            <h3 className="pd-title side-heading">
              <span className="material-symbols-outlined" aria-hidden="true" style={{ color: 'var(--pd-yellow)' }}>
                bolt
              </span>
              Unirse con Código
            </h3>
            <JoinByCodeForm />
          </div>

          <div className="pd-divider" />

          <div>
            <h3 className="pd-title" style={{ marginBottom: 'var(--pd-space-3)' }}>
              Crear Sala
            </h3>
            <CreateRoomForm />
          </div>
        </aside>
      </div>
    </div>
  )
}

export default LobbyScreen
export { RoomList, RoomCard, CreateRoomForm, JoinByCodeForm, ChangeNicknameControl }
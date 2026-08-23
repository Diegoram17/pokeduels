import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import { validateNickname } from '../lib/validation'
import { createSession, describeApiError } from '../lib/api'
import ErrorBanner from '../components/ErrorBanner'
import loginBg from '../assets/login-bg.jpg'

/**
 * Screen 1: Login. Static arena artwork (non-editable) plus a nickname form
 * that validates 3–20 characters (trimmed) before POSTing a real backend
 * session (POST /api/session). The returned playerId/sessionToken are stored
 * in app state before navigating to the lobby; failures render an inline
 * error banner with a manual retry (no automatic redirects).
 */

function LoginBackground() {
  return (
    <img
      className="pd-art-layer"
      src={loginBg}
      alt="Fondo de la arena"
      style={{ objectFit: 'cover', width: '100%', height: '100%' }}
    />
  )
}

function NicknameForm() {
  const [, actions] = useMockState()
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)

  async function establishSession() {
    setSessionError(null)
    try {
      const session = await createSession(value)
      actions.sessionEstablished({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        nickname: value.trim(),
      })
      navigate('/lobby')
    } catch (err) {
      setSessionError(describeApiError(err))
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = validateNickname(value)
    if (message) {
      setValidationError(message)
      return
    }
    void establishSession()
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-5)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-2)' }}>
        <label htmlFor="nickname" className="pd-label">
          Nickname
        </label>
        <div className="pd-input-wrap">
          <span className="material-symbols-outlined pd-input-icon" aria-hidden="true">
            badge
          </span>
          <input
            id="nickname"
            type="text"
            required
            autoComplete="off"
            placeholder="INTRODUCE TU APODO"
            className="pd-input pd-input--icon"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setValidationError(null)
              setSessionError(null)
            }}
          />
        </div>
        {validationError && (
          <p role="alert" className="pd-meta" style={{ color: 'var(--pd-danger)' }}>
            {validationError}
          </p>
        )}
        {sessionError && <ErrorBanner message={sessionError} onRetry={() => void establishSession()} />}
      </div>

      <button type="submit" className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg">
        <span>ENTRAR A JUGAR</span>
        <span className="pd-btn__shine" />
      </button>
    </form>
  )
}

function LoginScreen() {
  return (
    <div
      className="pd-page"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--pd-space-5) 40px' }}
    >
      <LoginBackground />
      <div className="pd-scrim-v" />
      <div className="pd-scrim-d" />
      <div className="pd-glow-blob" style={{ right: '-8%', top: '16%', width: 700, height: 700 }} />
      <div className="pd-grid-perspective" />

      <main
        style={{
          position: 'relative',
          zIndex: 5,
          width: '100%',
          maxWidth: 1560,
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 72,
          alignItems: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-5)', textAlign: 'left' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pd-space-2)' }}>
              <span className="pd-pokeball" />
              <span className="pd-eyebrow">Arena oficial</span>
            </div>
            <h1 className="pd-logo pd-logo--hero">Poke-duels</h1>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-3)' }}>
            <h2 className="pd-title">¡Hola, Entrenador!</h2>
            <p className="pd-body" style={{ maxWidth: 470 }}>
              Ingresa tu apodo, arma tu equipo de 6 Pokémon y demuestra quién manda en la arena.
            </p>
          </div>
        </div>

        <div className="pd-card" style={{ padding: 'var(--pd-space-6)', width: 432 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--pd-space-3)',
              marginBottom: 'var(--pd-space-5)',
            }}
          >
            <h3 className="pd-label" style={{ letterSpacing: '.28em' }}>
              INICIAR SESIÓN
            </h3>
            <span className="pd-pokeball" style={{ width: 16, height: 16 }} />
          </div>
          <NicknameForm />
        </div>
      </main>
    </div>
  )
}

export default LoginScreen
export { LoginBackground, NicknameForm }
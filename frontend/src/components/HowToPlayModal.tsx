import { useRef } from 'react'
import Modal from './Modal'

export interface HowToPlayModalProps {
  onClose: () => void
}

// Verbatim super-effective (x2) matchups from the game's type_effectiveness
// seed data — keep in sync if that data changes.
const TYPE_ADVANTAGES: Array<{ emoji: string; label: string; beats: string }> = [
  { emoji: '🔥', label: 'Fuego', beats: 'Planta, Hielo, Bicho, Acero' },
  { emoji: '💧', label: 'Agua', beats: 'Fuego, Tierra, Roca' },
  { emoji: '🌿', label: 'Planta', beats: 'Agua, Tierra, Roca' },
  { emoji: '⚡', label: 'Eléctrico', beats: 'Agua, Volador' },
  { emoji: '❄️', label: 'Hielo', beats: 'Planta, Tierra, Volador, Dragón' },
  { emoji: '🥊', label: 'Lucha', beats: 'Normal, Hielo, Roca, Siniestro, Acero' },
  { emoji: '☠️', label: 'Veneno', beats: 'Planta, Hada' },
  { emoji: '⏳', label: 'Tierra', beats: 'Fuego, Eléctrico, Veneno, Roca, Acero' },
  { emoji: '🦅', label: 'Volador', beats: 'Planta, Lucha, Bicho' },
  { emoji: '🔮', label: 'Psíquico', beats: 'Lucha, Veneno' },
  { emoji: '🐛', label: 'Bicho', beats: 'Planta, Psíquico, Siniestro' },
  { emoji: '🪨', label: 'Roca', beats: 'Fuego, Hielo, Volador, Bicho' },
  { emoji: '👻', label: 'Fantasma', beats: 'Psíquico, Fantasma' },
  { emoji: '🐉', label: 'Dragón', beats: 'Dragón' },
  { emoji: '🌙', label: 'Siniestro', beats: 'Psíquico, Fantasma' },
  { emoji: '⚙️', label: 'Acero', beats: 'Hielo, Roca, Hada' },
  { emoji: '✨', label: 'Hada', beats: 'Lucha, Dragón, Siniestro' },
  { emoji: '👤', label: 'Normal', beats: 'Sin ventajas (daño neutro)' },
]

/**
 * Team Select "¿CÓMO JUGAR?" modal: explains the type-advantage matchups a
 * player needs to draft a balanced team. Thin <Modal> consumer (size="lg",
 * mirrors RulesModal's pattern) — opened automatically on screen entry and
 * reachable again anytime via the topbar button.
 */
export default function HowToPlayModal({ onClose }: HowToPlayModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal ariaLabel="Cómo jugar" onClose={onClose} initialFocusRef={closeBtnRef} size="lg">
      <h2 className="pd-title" style={{ marginBottom: 12 }}>
        Sistema de Ventaja de Tipos ⚔️
      </h2>
      <p className="pd-body" style={{ marginBottom: 16 }}>
        En Poke-Duels, la ventaja de tipo aumenta tu poder de ataque. Resumen de efectividades:
      </p>

      <ul className="pd-body" style={{ marginBottom: 16, paddingLeft: 20 }}>
        {TYPE_ADVANTAGES.map(({ emoji, label, beats }) => (
          <li key={label}>
            {emoji} <strong>{label}:</strong> {beats}
          </li>
        ))}
      </ul>

      <p className="pd-meta" style={{ marginBottom: 24 }}>
        Tip: Elige un equipo variado para asegurar ventaja en cualquier combate.
      </p>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          ref={closeBtnRef}
          className="pd-btn pd-btn--secondary"
          onClick={onClose}
        >
          CERRAR
        </button>
      </div>
    </Modal>
  )
}

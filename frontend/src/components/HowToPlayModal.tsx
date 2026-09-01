import { useRef } from 'react'
import Modal from './Modal'

export interface HowToPlayModalProps {
  onClose: () => void
}

/**
 * Team Select "¿CÓMO JUGAR?" modal: explains the type-advantage matchups a
 * player needs to draft a balanced team. Thin <Modal> consumer (size="sm"),
 * mirroring RulesModal's pattern. Matchups are the verbatim curated pairs
 * from the game's type_effectiveness seed data — keep in sync if that data
 * changes.
 */
export default function HowToPlayModal({ onClose }: HowToPlayModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal ariaLabel="Cómo jugar" onClose={onClose} initialFocusRef={closeBtnRef} size="sm">
      <h2 className="pd-title" style={{ marginBottom: 8 }}>
        Sistema de Ventaja de Tipos ⚔️
      </h2>
      <p className="pd-body" style={{ marginBottom: 16, textAlign: 'left' }}>
        En Poke-Duels, la victoria depende del tipo de tu Pokémon. Cada tipo tiene ventaja sobre
        otros en su poder de ataque:
      </p>

      <ul className="pd-body" style={{ marginBottom: 16, paddingLeft: 20, textAlign: 'left' }}>
        <li>⚡ Eléctrico vence a Agua</li>
        <li>💧 Agua vence a Tierra / Fuego</li>
        <li>🔥 Fuego vence a Planta</li>
        <li>🌿 Planta vence a Agua / Tierra</li>
      </ul>

      <p className="pd-meta" style={{ marginBottom: 24, textAlign: 'left' }}>
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

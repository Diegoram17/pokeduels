import { useRef } from 'react'
import Modal from './Modal'

export interface RulesModalProps {
  onClose: () => void
}

/**
 * Lobby "Reglas del juego" modal (BACKLOG item #19, Fase 7). Thin <Modal>
 * consumer with the size="lg" affordance: the four rule blocks are wrapped in
 * the scrollable .pd-modal-body so they stay reachable without scrolling the
 * page. The rules text is the verbatim approved copy — do not edit wording.
 * Initial focus lands on CERRAR; Escape and the focus trap come from <Modal>.
 */
export default function RulesModal({ onClose }: RulesModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal ariaLabel="Reglas del juego" onClose={onClose} initialFocusRef={closeBtnRef} size="lg">
      <h2 className="pd-title" style={{ marginBottom: 12 }}>
        ⚡ DUELOS POKÉMON
      </h2>
      <p className="pd-body" style={{ marginBottom: 16 }}>
        Sin niveles, objetos ni golpes críticos. Gana quien mejor maneje la ventaja de tipos y
        anticipe al rival.
      </p>

      <h3 className="pd-title" style={{ fontSize: 18, marginBottom: 8 }}>
        Armá tu Escuadrón
      </h3>
      <ul className="pd-body" style={{ marginBottom: 16, paddingLeft: 20 }}>
        <li>
          <strong>Inicial único:</strong> Pikachu, Bulbasaur, Squirtle o Charmander (el primero que
          lo confirma en la sala se lo queda).
        </li>
        <li>
          <strong>Plantel:</strong> Sumá 5 Pokémon del catálogo para completar tu 6 ideal.
        </li>
      </ul>

      <h3 className="pd-title" style={{ fontSize: 18, marginBottom: 8 }}>
        Reglas de Batalla
      </h3>
      <ul className="pd-body" style={{ marginBottom: 16, paddingLeft: 20 }}>
        <li>
          <strong>Salud:</strong> todos inician con 100 HP.
        </li>
        <li>
          <strong>Ataques:</strong> 4 movimientos fijos (25, 20 y 15 de daño con 4 PP cada uno; 10
          de daño con uso ilimitado).
        </li>
        <li>
          <strong>Tipos:</strong> Supereficaz (x2), Poco eficaz (x0.5, mín. 1) y Neutral (x1). Sin
          inmunidades.
        </li>
        <li>
          <strong>Combate a ciegas:</strong> elección simultánea y prioridad al azar. Si nokeás al
          rival, cancelás su ataque.
        </li>
        <li>
          <strong>Sin pausas:</strong> cambiar de Pokémon o entrar tras un K.O. te permite atacar en
          esa misma ronda.
        </li>
        <li>
          <strong>Tiempo límite:</strong> si te quedás sin tiempo, se usa automáticamente el ataque
          de 10 de daño.
        </li>
        <li>
          <strong>Desconexión:</strong> si el rival se va, ganás el duelo al instante.
        </li>
      </ul>

      <h3 className="pd-title" style={{ fontSize: 18, marginBottom: 8 }}>
        Formato de Juego
      </h3>
      <ul className="pd-body" style={{ marginBottom: 24, paddingLeft: 20 }}>
        <li>
          <strong>Salas de 2:</strong> duelo directo. El ganador se corona Campeón.
        </li>
        <li>
          <strong>Salas de 4:</strong> torneo de 2 semifinales. Ganadores definen 1.º/2.º puesto y
          perdedores 3.º/4.º. HP y PP se restauran al 100 % entre partidas.
        </li>
      </ul>

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
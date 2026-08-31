// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RulesModal from '../RulesModal'

describe('RulesModal', () => {
  it('renders the rules dialog with the Duelos Pok\u00e9mon title and the three rule section headings', () => {
    render(<RulesModal onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: /reglas del juego/i })
    expect(dialog).toHaveTextContent('DUELOS POK\u00c9MON')
    expect(dialog).toHaveTextContent('Arm\u00e1 tu Escuadr\u00f3n')
    expect(dialog).toHaveTextContent('Reglas de Batalla')
    expect(dialog).toHaveTextContent('Formato de Juego')
  })

  it('closes via the CERRAR button calling onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<RulesModal onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('places initial focus on the CERRAR button', () => {
    render(<RulesModal onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /cerrar/i })).toHaveFocus()
  })
})
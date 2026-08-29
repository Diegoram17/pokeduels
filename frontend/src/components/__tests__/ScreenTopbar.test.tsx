// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ScreenTopbar from '../ScreenTopbar'

describe('ScreenTopbar', () => {
  it('renders the logo and the uppercased nickname badge', () => {
    render(<ScreenTopbar nickname="Ash Ketchum" />)
    expect(screen.getByText('Poke-duels')).toBeInTheDocument()
    expect(screen.getByText('ASH KETCHUM')).toBeInTheDocument()
  })

  it('falls back to ENTRENADOR for an empty nickname', () => {
    render(<ScreenTopbar nickname="" />)
    expect(screen.getByText('ENTRENADOR')).toBeInTheDocument()
  })

  it('renders children in the topbar end slot', () => {
    render(
      <ScreenTopbar nickname="Ash">
        <button type="button">RENDIRSE / SALIR</button>
      </ScreenTopbar>,
    )
    expect(screen.getByRole('button', { name: /rendirse \/ salir/i })).toBeInTheDocument()
  })
})
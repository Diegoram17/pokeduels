// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

  // Fase 7: canonical 3-slot layout (design "ScreenTopbar canonical 3-slot").
  // The slot structure IS the contract: nickname left, logo absolutely centered,
  // per-screen action slot right. jsdom cannot resolve the absolute-position CSS,
  // so the slot membership of each piece of content is the observable proxy.

  it('renders the Poke-duels logo inside the centered .pd-topbar__logo slot', () => {
    const { container } = render(<ScreenTopbar nickname="Ash Ketchum" />)
    const logoSlot = container.querySelector('.pd-topbar__logo')
    expect(logoSlot).not.toBeNull()
    expect(logoSlot).toHaveTextContent('Poke-duels')
  })

  it('renders the nickname badge inside the left .pd-topbar__start slot', () => {
    const { container } = render(<ScreenTopbar nickname="Misty" />)
    const startSlot = container.querySelector('.pd-topbar__start')
    expect(startSlot).not.toBeNull()
    expect(within(startSlot as HTMLElement).getByText('MISTY')).toBeInTheDocument()
    // The start slot must not swallow the children slot.
    expect(container.querySelector('.pd-topbar__start')).not.toContainElement(
      container.querySelector('.pd-topbar__end'),
    )
  })

  it('renders children inside the right .pd-topbar__end slot, distinct from the start slot', () => {
    const { container } = render(
      <ScreenTopbar nickname="Ash">
        <button type="button">SALIR</button>
      </ScreenTopbar>,
    )
    const endSlot = container.querySelector<HTMLElement>('.pd-topbar__end')
    expect(endSlot).not.toBeNull()
    expect(within(endSlot as HTMLElement).getByRole('button', { name: /salir/i })).toBeInTheDocument()
    const startSlot = container.querySelector<HTMLElement>('.pd-topbar__start')
    expect(startSlot).not.toContainElement(endSlot)
  })

  it('keeps the nickname badge out of the end slot (start owns the nickname)', () => {
    const { container } = render(<ScreenTopbar nickname="Brock" />)
    const endSlot = container.querySelector('.pd-topbar__end')
    expect(within(endSlot as HTMLElement).queryByText('BROCK')).not.toBeInTheDocument()
  })
})
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import HpBar from '../HpBar'

describe('HpBar', () => {
  it('renders a progressbar with aria-valuenow/min/max and the default HP label', () => {
    render(<HpBar hp={80} />)
    const bar = screen.getByRole('progressbar', { name: 'HP' })
    expect(bar).toHaveAttribute('aria-valuenow', '80')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('sizes the fill proportionally and uses the high tone above 50%', () => {
    render(<HpBar hp={80} />)
    const bar = screen.getByRole('progressbar')
    const fill = bar.querySelector('.pd-hp-fill') as HTMLElement
    expect(fill.style.width).toBe('80%')
    expect(fill.className).toContain('pd-hp-fill--high')
  })

  it('uses the mid tone at 21% (above 20, at or below 50)', () => {
    render(<HpBar hp={21} />)
    const bar = screen.getByRole('progressbar')
    const fill = bar.querySelector('.pd-hp-fill') as HTMLElement
    expect(fill.className).toContain('pd-hp-fill--mid')
  })

  it('uses the low tone at 20% (at or below 20)', () => {
    render(<HpBar hp={20} />)
    const bar = screen.getByRole('progressbar')
    const fill = bar.querySelector('.pd-hp-fill') as HTMLElement
    expect(fill.className).toContain('pd-hp-fill--low')
  })

  it('accepts a custom aria label and max', () => {
    render(<HpBar hp={40} max={200} ariaLabel="HP de Pikachu" />)
    const bar = screen.getByRole('progressbar', { name: 'HP de Pikachu' })
    expect(bar).toHaveAttribute('aria-valuemax', '200')
    expect(bar).toHaveAttribute('aria-valuenow', '40')
  })

  it('clamps hp above max to a full bar', () => {
    render(<HpBar hp={150} />)
    const bar = screen.getByRole('progressbar')
    const fill = bar.querySelector('.pd-hp-fill') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })
})
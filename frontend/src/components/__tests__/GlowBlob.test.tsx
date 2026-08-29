// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import GlowBlob from '../GlowBlob'

describe('GlowBlob', () => {
  it('renders a single .pd-glow-blob div', () => {
    const { container } = render(<GlowBlob style={{ top: '10%', width: 700 }} />)
    const blob = container.querySelector('.pd-glow-blob')
    expect(blob).not.toBeNull()
    expect(blob!.tagName).toBe('DIV')
    expect(container.querySelectorAll('.pd-glow-blob')).toHaveLength(1)
  })

  it('forwards the style prop to the element', () => {
    const { container } = render(
      <GlowBlob style={{ left: '50%', top: '-10%', width: 700, height: 700, transform: 'translateX(-50%)' }} />,
    )
    const blob = container.querySelector('.pd-glow-blob') as HTMLElement
    expect(blob.style.left).toBe('50%')
    expect(blob.style.top).toBe('-10%')
    expect(blob.style.width).toBe('700px')
    expect(blob.style.height).toBe('700px')
    expect(blob.style.transform).toBe('translateX(-50%)')
  })

  it('emits no testid and no ARIA role (decorative contract)', () => {
    const { container } = render(<GlowBlob style={{ top: '20%' }} />)
    const blob = container.querySelector('.pd-glow-blob') as HTMLElement
    expect(blob.getAttribute('data-testid')).toBeNull()
    expect(blob.getAttribute('role')).toBeNull()
  })
})
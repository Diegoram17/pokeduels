// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import NicknameBadge from '../NicknameBadge'

describe('NicknameBadge', () => {
  it('renders the nickname uppercased', () => {
    render(<NicknameBadge nickname="Ash Ketchum" />)
    expect(screen.getByText('ASH KETCHUM')).toBeInTheDocument()
  })

  it('falls back to ENTRENADOR when the nickname is empty', () => {
    render(<NicknameBadge nickname="" />)
    expect(screen.getByText('ENTRENADOR')).toBeInTheDocument()
  })

  it('forwards data-testid to the badge element', () => {
    render(<NicknameBadge nickname="Ash" data-testid="lobby-nickname" />)
    expect(screen.getByTestId('lobby-nickname')).toHaveTextContent('ASH')
  })
})
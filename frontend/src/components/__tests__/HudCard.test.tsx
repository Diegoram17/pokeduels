// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HudCard } from '../PokemonCard'
import type { DuelPokemonState } from '../../state/schema'

function makePokemon(overrides: Partial<DuelPokemonState> = {}): DuelPokemonState {
  return {
    duelId: 'd1',
    ownerId: 1,
    pokemonId: 25,
    name: 'Pikachu',
    type: 'electric',
    spriteUrl: '/pikachu.png',
    backSpriteUrl: '/pikachu-back.png',
    currentHp: 80,
    ppMove1: 3,
    ppMove2: 3,
    ppMove3: 3,
    isActive: true,
    fainted: false,
    ...overrides,
  }
}

describe('HudCard', () => {
  it('renders the human side with name, type and HP text', () => {
    render(<HudCard pokemon={makePokemon()} side="human" />)
    const card = screen.getByTestId('hud-human')
    expect(card).toHaveTextContent('PIKACHU')
    expect(card).toHaveTextContent('ELECTRIC')
    expect(card).toHaveTextContent('80/100')
  })

  it('renders the rival side with its own HP and the rival border', () => {
    render(<HudCard pokemon={makePokemon({ currentHp: 34 })} side="rival" />)
    const card = screen.getByTestId('hud-rival')
    expect(card).toHaveTextContent('PIKACHU')
    expect(card).toHaveTextContent('34/100')
    // Inline style assertion: jsdom's getComputedStyle cannot resolve the
    // `var(--pd-red)` custom property, so assert the inline declaration
    // (the designed conditional-rival-border contract) directly.
    expect(card.style.borderRight).toBe('4px solid var(--pd-red)')
  })

  it('does not apply the rival border on the human side', () => {
    render(<HudCard pokemon={makePokemon()} side="human" />)
    expect(screen.getByTestId('hud-human').style.borderRight).toBe('')
  })

  it('shows the back sprite for the human side and the front sprite for the rival', () => {
    const { rerender } = render(<HudCard pokemon={makePokemon()} side="human" />)
    expect(screen.getByAltText('Pikachu')).toHaveAttribute('src', '/pikachu-back.png')
    rerender(<HudCard pokemon={makePokemon()} side="rival" />)
    expect(screen.getByAltText('Pikachu')).toHaveAttribute('src', '/pikachu.png')
  })
})
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import BracketTree from '../BracketTree'
import type { RoomState, TournamentState } from '../../state/schema'

const fourPlayerRoom: RoomState = {
  code: 'AB12',
  maxPlayers: 4,
  status: 'waiting',
  players: [
    { playerId: '10', nickname: 'Ash', ready: false, connected: true },
    { playerId: '11', nickname: 'Misty', ready: false, connected: true },
    { playerId: '12', nickname: 'Brock', ready: false, connected: true },
    { playerId: '13', nickname: 'Gary', ready: false, connected: true },
  ],
}

const twoPlayerRoom: RoomState = {
  ...fourPlayerRoom,
  maxPlayers: 2,
  players: fourPlayerRoom.players.slice(0, 2),
}

describe('BracketTree', () => {
  it('renders the SVG connector tree with P1/P2 slots and Gran Final for a 4-player room', () => {
    const bracket: TournamentState['bracket'] = {
      semiA: { duelId: '42', playerA: '10', playerB: '11' },
      semiB: { duelId: '43', playerA: '12', playerB: '13' },
    }
    const { container } = render(<BracketTree bracket={bracket} room={fourPlayerRoom} />)

    expect(container.querySelector('.bracket-wrap svg')).not.toBeNull()
    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('P2')).toBeInTheDocument()
    expect(screen.getByText('Gran Final')).toBeInTheDocument()
    // Roster names resolve through the room players.
    expect(screen.getByText('Ash')).toBeInTheDocument()
    expect(screen.getByText('Misty')).toBeInTheDocument()
    expect(screen.getByText('Brock')).toBeInTheDocument()
    expect(screen.getByText('Gary')).toBeInTheDocument()
  })

  it('renders TBD and dims an unfilled slot', () => {
    const bracket: TournamentState['bracket'] = {
      semiA: { duelId: '42', playerA: '10', playerB: '11' },
      semiB: null,
      final: null,
      thirdPlace: null,
    }
    const { container } = render(<BracketTree bracket={bracket} room={fourPlayerRoom} />)

    const finalCard = container.querySelector('.final-slot .pd-card') as HTMLElement
    expect(finalCard).not.toBeNull()
    expect(within(finalCard).getAllByText('TBD')).toHaveLength(2)
    expect(finalCard.style.opacity).toBe('0.6')
  })

  it('renders nothing for a 2-player room', () => {
    const { container } = render(<BracketTree bracket={{}} room={twoPlayerRoom} />)

    expect(container.querySelector('.bracket-wrap')).toBeNull()
    expect(container.querySelector('.bracket-row')).toBeNull()
  })
})
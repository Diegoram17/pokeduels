import type { MoveIndex } from './damage'

// Random move selection with no scripted or difficulty-based logic.
export function chooseBotMove(): MoveIndex {
  return Math.floor(Math.random() * 4) as MoveIndex
}
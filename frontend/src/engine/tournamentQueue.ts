import type { TournamentSlot, TournamentState } from '../state/schema'

const SEED_QUEUE: TournamentSlot[] = ['semiA', 'semiB']
const SECOND_ROUND: TournamentSlot[] = ['thirdPlace', 'final']

/**
 * Advances the tournament FIFO queue and returns the next slot to play.
 *
 * The queue is seeded with ["semiA","semiB"] at room creation; once both
 * semifinals have a result, ["thirdPlace","final"] is appended in that fixed
 * order. `activeSlot` moves to the first slot in the queue that has no result
 * yet (tournament done when every slot has a result).
 */
export function advanceQueue(tournament: TournamentState): TournamentState {
  const queue = [...tournament.queue]
  const semisDone =
    tournament.results.semiA != null && tournament.results.semiB != null

  if (semisDone && !queue.includes('thirdPlace')) {
    queue.push(...SECOND_ROUND)
  }

  const nextSlot = queue.find((slot) => tournament.results[slot] == null)

  return {
    ...tournament,
    queue,
    // When every slot is resolved the tournament is complete: settle on the
    // last slot played (the final), which is also the routing signal for the
    // ranking screen.
    activeSlot: nextSlot ?? queue[queue.length - 1] ?? tournament.activeSlot,
  }
}

export { SEED_QUEUE }
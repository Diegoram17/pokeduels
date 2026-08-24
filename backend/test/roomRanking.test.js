import { describe, it, expect } from 'vitest';
import { computeOneVOneRanks } from '../db/rooms.js';

/**
 * Pure unit tests for the 1v1 final-rank decision (item #7, PR 2 close-and-rank).
 * The rank rule (from the proposal/spec):
 *   - PRIMARY: the player with more total duel wins across the room's finished
 *     duels ranks 1st; the other ranks 2nd.
 *   - TIEBREAK (only when win counts are exactly equal): the winner of the most
 *     recently finished duel ranks 1st.
 * A pure function so the decision is testable without a DB.
 */
describe('computeOneVOneRanks', () => {
  it('ranks by total win count when the counts differ (2-1 rematch series)', () => {
    const ranks = computeOneVOneRanks(10, 20, { 10: 2, 20: 1 }, 99);
    expect(ranks).toEqual([
      { playerId: 10, finalRank: 1 },
      { playerId: 20, finalRank: 2 },
    ]);
  });

  it('ranks by win count when the second player leads (1-2 series)', () => {
    const ranks = computeOneVOneRanks(10, 20, { 10: 1, 20: 3 }, 10);
    expect(ranks).toEqual([
      { playerId: 20, finalRank: 1 },
      { playerId: 10, finalRank: 2 },
    ]);
  });

  it('uses the most-recent-duel winner as tiebreak when win counts are equal (1-1 tie)', () => {
    const ranks = computeOneVOneRanks(10, 20, { 10: 1, 20: 1 }, 20);
    expect(ranks).toEqual([
      { playerId: 20, finalRank: 1 },
      { playerId: 10, finalRank: 2 },
    ]);
  });

  it('treats a seat with no recorded wins as zero (1-0 walkover series)', () => {
    const ranks = computeOneVOneRanks(10, 20, { 10: 1 }, 10);
    expect(ranks).toEqual([
      { playerId: 10, finalRank: 1 },
      { playerId: 20, finalRank: 2 },
    ]);
  });
});

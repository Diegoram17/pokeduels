import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit tests for `walkoverPendingDuel` (item #7, PR 3) — the shared expire
// callback for both bracket-walkover arm sites. The finish->advance chain is
// verified by injecting a spy as `deps.advance` (the real advance function is
// covered by tournamentLifecycle.test.js). `pool`, the duel repository and the
// duel lifecycle are mocked.
vi.mock('../db/pool.js', () => ({
  pool: { connect: vi.fn(), query: vi.fn() },
}));
vi.mock('../repositories/duelRepository.js', () => ({
  createDuelFromRoom: vi.fn(),
  findPendingBracketDuelForPlayer: vi.fn(),
  finishDuelByWalkover: vi.fn(),
}));
vi.mock('../ws/duelLifecycle.js', () => ({
  finalizeDuelSideEffects: vi.fn(),
}));

import { findPendingBracketDuelForPlayer, finishDuelByWalkover } from '../repositories/duelRepository.js';
import { finalizeDuelSideEffects } from '../ws/duelLifecycle.js';
import { walkoverPendingDuel } from '../ws/tournamentLifecycle.js';

const io = { to: vi.fn(() => ({ emit: vi.fn() })) };

describe('walkoverPendingDuel (item #7, PR 3 — shared walkover expire handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a walkover for the pending duel, finalizes, and advances the tournament', async () => {
    findPendingBracketDuelForPlayer.mockResolvedValue({
      id: 30,
      round: 'final',
      status: 'pending',
      player1_id: 1,
      player2_id: 3,
    });
    finishDuelByWalkover.mockResolvedValue({ applied: true });
    const advance = vi.fn();

    const result = await walkoverPendingDuel(io, 7, 1, { advance });

    expect(findPendingBracketDuelForPlayer).toHaveBeenCalledWith(7, 1);
    // Opponent is the other seat of the pending duel (player 3).
    expect(finishDuelByWalkover).toHaveBeenCalledWith(30, 3);
    expect(finalizeDuelSideEffects).toHaveBeenCalledWith(io, 30, 3, 'walkover');
    // The tournament is re-advanced after the walkover finish.
    expect(advance).toHaveBeenCalledWith(io, 7, 30, { advance });
    expect(result).toEqual({ applied: true });
  });

  it('does nothing when the player has no pending duel', async () => {
    findPendingBracketDuelForPlayer.mockResolvedValue(null);
    const advance = vi.fn();
    const result = await walkoverPendingDuel(io, 7, 1, { advance });
    expect(result).toEqual({ applied: false });
    expect(finishDuelByWalkover).not.toHaveBeenCalled();
    expect(finalizeDuelSideEffects).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it('does not finalize or advance when the walkover write did not apply (already finished)', async () => {
    findPendingBracketDuelForPlayer.mockResolvedValue({
      id: 30,
      round: 'final',
      status: 'pending',
      player1_id: 1,
      player2_id: 3,
    });
    finishDuelByWalkover.mockResolvedValue({ applied: false });
    const advance = vi.fn();

    const result = await walkoverPendingDuel(io, 7, 1, { advance });
    expect(result).toEqual({ applied: false });
    expect(finalizeDuelSideEffects).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });
});

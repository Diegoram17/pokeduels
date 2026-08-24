import { describe, it, expect } from 'vitest';
import {
  validateSwitchDecisionCore,
  validateLeadSelectionCore,
  ValidationError,
} from '../engine/switchValidation.js';

// Fake rosters — same shape the repository's getPlayerRoster returns per
// player (player_id, pokemon_id, fainted, is_active).
const p1Roster = [
  { id: 10, duel_id: 1, player_id: 1, pokemon_id: 101, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: true, fainted: false, type: 'normal' },
  { id: 11, duel_id: 1, player_id: 1, pokemon_id: 102, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: false, fainted: false, type: 'fire' },
  { id: 12, duel_id: 1, player_id: 1, pokemon_id: 103, current_hp: 0, pp_move_1: 0, pp_move_2: 0, pp_move_3: 0, is_active: false, fainted: true, type: 'water' },
];
const p2Roster = [
  { id: 13, duel_id: 1, player_id: 2, pokemon_id: 201, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: true, fainted: false, type: 'grass' },
  { id: 14, duel_id: 1, player_id: 2, pokemon_id: 202, current_hp: 100, pp_move_1: 4, pp_move_2: 4, pp_move_3: 4, is_active: false, fainted: false, type: 'water' },
];

describe('validateSwitchDecisionCore', () => {
  it('accepts a valid switch: owned, not fainted, not already active', () => {
    expect(validateSwitchDecisionCore(p1Roster, 1, 102)).toBe(true);
    expect(validateSwitchDecisionCore(p2Roster, 2, 202)).toBe(true);
  });

  it('rejects a switch to the opposing player\'s pokemon (wrong_owner)', () => {
    expect(() => validateSwitchDecisionCore(p1Roster, 1, 201)).toThrow(ValidationError);
    expect(() => validateSwitchDecisionCore(p2Roster, 2, 101)).toThrow(/wrong_owner/);
  });

  it('rejects a switch to a pokemon not present in the roster (wrong_owner)', () => {
    expect(() => validateSwitchDecisionCore(p1Roster, 1, 999)).toThrow(/wrong_owner/);
  });

  it('rejects a switch to a fainted pokemon', () => {
    expect(() => validateSwitchDecisionCore(p1Roster, 1, 103)).toThrow(ValidationError);
    expect(() => validateSwitchDecisionCore(p1Roster, 1, 103)).toThrow(/fainted/);
  });

  it('rejects a switch to the already-active pokemon', () => {
    expect(() => validateSwitchDecisionCore(p1Roster, 1, 101)).toThrow(/already_active/);
    expect(() => validateSwitchDecisionCore(p2Roster, 2, 201)).toThrow(/already_active/);
  });

  it('reports the failing reason on the thrown ValidationError', () => {
    try {
      validateSwitchDecisionCore(p1Roster, 1, 201);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.reason).toBe('wrong_owner');
      expect(err.name).toBe('ValidationError');
    }
  });

  it('checks ownership before fainted/already-active', () => {
    // 103 belongs to P1 and is fainted; a wrong-owner query on it from P2's
    // roster still fails on ownership first — deterministic reason ordering.
    expect(() => validateSwitchDecisionCore(p2Roster, 2, 103)).toThrow(/wrong_owner/);
  });
});

// First-activation lead selection (item #5): ownership + not-fainted ONLY.
// Deliberately no `already_active` check — a first pick happens when nothing
// is active yet, so rejecting the roster's active flag would reject every pick.
describe('validateLeadSelectionCore', () => {
  it('accepts a valid first lead: owned and not fainted', () => {
    expect(validateLeadSelectionCore(p1Roster, 1, 102)).toBe(true);
    expect(validateLeadSelectionCore(p2Roster, 2, 202)).toBe(true);
  });

  it('accepts the already-active pokemon as a lead (first pick has no active constraint)', () => {
    // 101 is is_active=true in the fake roster, but lead selection must NOT
    // reject it — that is exactly the first pick path.
    expect(validateLeadSelectionCore(p1Roster, 1, 101)).toBe(true);
  });

  it("rejects a lead targeting the opposing player's pokemon (wrong_owner)", () => {
    expect(() => validateLeadSelectionCore(p1Roster, 1, 201)).toThrow(ValidationError);
    expect(() => validateLeadSelectionCore(p2Roster, 2, 101)).toThrow(/wrong_owner/);
  });

  it('rejects a lead to a pokemon not present in the roster (wrong_owner)', () => {
    expect(() => validateLeadSelectionCore(p1Roster, 1, 999)).toThrow(/wrong_owner/);
  });

  it('rejects a fainted lead', () => {
    expect(() => validateLeadSelectionCore(p1Roster, 1, 103)).toThrow(ValidationError);
    expect(() => validateLeadSelectionCore(p1Roster, 1, 103)).toThrow(/fainted/);
  });

  it('reports the failing reason on the thrown ValidationError', () => {
    try {
      validateLeadSelectionCore(p1Roster, 1, 201);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.reason).toBe('wrong_owner');
      expect(err.name).toBe('ValidationError');
    }
  });
});
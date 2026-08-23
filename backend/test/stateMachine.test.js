import { describe, it, expect } from 'vitest';
import { PHASES, EVENTS, transition } from '../engine/stateMachine.js';

describe('PHASES enum', () => {
  it('exposes the five duel phases', () => {
    expect(PHASES).toEqual({
      PENDING: 'pending',
      LEAD_SELECTION: 'lead_selection',
      IN_PROGRESS: 'in_progress',
      FINISHED: 'finished',
      ABORTED: 'aborted',
    });
  });
});

describe('EVENTS enum', () => {
  it('exposes the transition events', () => {
    expect(EVENTS.START).toBe('start');
    expect(EVENTS.SELECT_LEADS).toBe('select_leads');
    expect(EVENTS.ROUND_RESOLVED).toBe('round_resolved');
    expect(EVENTS.FINISH).toBe('finish');
    expect(EVENTS.ABORT).toBe('abort');
  });
});

describe('transition', () => {
  it('pending + start -> lead_selection', () => {
    expect(transition(PHASES.PENDING, EVENTS.START)).toBe('lead_selection');
  });

  it('pending + abort -> aborted', () => {
    expect(transition(PHASES.PENDING, EVENTS.ABORT)).toBe('aborted');
  });

  it('lead_selection + select_leads -> in_progress', () => {
    expect(transition(PHASES.LEAD_SELECTION, EVENTS.SELECT_LEADS)).toBe(
      'in_progress',
    );
  });

  it('lead_selection + abort -> aborted', () => {
    expect(transition(PHASES.LEAD_SELECTION, EVENTS.ABORT)).toBe('aborted');
  });

  it('in_progress + round_resolved stays in_progress', () => {
    expect(transition(PHASES.IN_PROGRESS, EVENTS.ROUND_RESOLVED)).toBe(
      'in_progress',
    );
  });

  it('in_progress + finish -> finished', () => {
    expect(transition(PHASES.IN_PROGRESS, EVENTS.FINISH)).toBe('finished');
  });

  it('in_progress + abort -> aborted', () => {
    expect(transition(PHASES.IN_PROGRESS, EVENTS.ABORT)).toBe('aborted');
  });

  it('throws on an invalid event for the current phase', () => {
    expect(() => transition(PHASES.PENDING, EVENTS.FINISH)).toThrow(
      /No transition from "pending" on event "finish"/,
    );
  });

  it('throws when the phase is unknown', () => {
    expect(() => transition('unknown_phase', EVENTS.START)).toThrow(
      /Unknown phase "unknown_phase"/,
    );
  });

  it('throws when the event is unknown', () => {
    expect(() => transition(PHASES.IN_PROGRESS, 'rewind')).toThrow(
      /No transition from "in_progress" on event "rewind"/,
    );
  });

  it('finished is terminal — no outgoing transitions', () => {
    for (const event of Object.values(EVENTS)) {
      expect(() => transition(PHASES.FINISHED, event)).toThrow(/No transition/);
    }
  });

  it('aborted is terminal — no outgoing transitions', () => {
    for (const event of Object.values(EVENTS)) {
      expect(() => transition(PHASES.ABORTED, event)).toThrow(/No transition/);
    }
  });
});
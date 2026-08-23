/**
 * Duel phase state machine (Phase 2).
 *
 * Five-phase FSM tracking the lifecycle of a duel, separate from the coarse
 * `duels.status` column in Postgres (which stays `pending/in_progress/finished`).
 * Pure module: `transition` is a total function over (phase, event) with no I/O,
 * so the whole table is unit-testable with zero DB.
 *
 *   pending ──start──────────▶ lead_selection ──select_leads──▶ in_progress
 *      │                           │                               │
 *      └──abort──┐                 └──abort──┐                     ├──round_resolved──▶ in_progress
 *                ▼                          ▼                     ├──finish──▶ finished
 *              aborted                    aborted                 └──abort──▶ aborted
 */

export const PHASES = Object.freeze({
  PENDING: 'pending',
  LEAD_SELECTION: 'lead_selection',
  IN_PROGRESS: 'in_progress',
  FINISHED: 'finished',
  ABORTED: 'aborted',
});

export const EVENTS = Object.freeze({
  /** pending -> lead_selection */
  START: 'start',
  /** lead_selection -> in_progress */
  SELECT_LEADS: 'select_leads',
  /** in_progress -> in_progress (a round completed without ending the duel) */
  ROUND_RESOLVED: 'round_resolved',
  /** in_progress -> finished (KO, surrender, disconnect) */
  FINISH: 'finish',
  /** any non-terminal phase -> aborted */
  ABORT: 'abort',
});

const TRANSITIONS = Object.freeze({
  [PHASES.PENDING]: Object.freeze({
    [EVENTS.START]: PHASES.LEAD_SELECTION,
    [EVENTS.ABORT]: PHASES.ABORTED,
  }),
  [PHASES.LEAD_SELECTION]: Object.freeze({
    [EVENTS.SELECT_LEADS]: PHASES.IN_PROGRESS,
    [EVENTS.ABORT]: PHASES.ABORTED,
  }),
  [PHASES.IN_PROGRESS]: Object.freeze({
    [EVENTS.ROUND_RESOLVED]: PHASES.IN_PROGRESS,
    [EVENTS.FINISH]: PHASES.FINISHED,
    [EVENTS.ABORT]: PHASES.ABORTED,
  }),
  [PHASES.FINISHED]: Object.freeze({}), // terminal
  [PHASES.ABORTED]: Object.freeze({}), // terminal
});

/**
 * Pure phase transition: returns the next phase for (currentPhase, event).
 * Throws when the phase is unknown or the event is not allowed from that phase.
 *
 * @param {string} currentPhase - one of PHASES
 * @param {string} event - one of EVENTS
 * @returns {string} the next phase
 * @throws {Error} on unknown phase or illegal transition
 */
export function transition(currentPhase, event) {
  const allowed = TRANSITIONS[currentPhase];
  if (!allowed) {
    throw new Error(`Unknown phase "${currentPhase}"`);
  }
  const next = allowed[event];
  if (next === undefined) {
    throw new Error(`No transition from "${currentPhase}" on event "${event}"`);
  }
  return next;
}
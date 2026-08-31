/**
 * Composition-root registry for the WS duel runtime (spec A1). One
 * DuelContext is constructed before any handler registration; every
 * per-duel collaborator resolves from that one context — the ordering hazard
 * is enforced by construction, not by comment.
 *
 * Slice 3b end-state: the context builds FRESH `createX()` instances (the
 * module singletons are deleted) and wires them with the two-phase
 * `bindLifecycle` init (design step 7) — the circular import turnCycle <->
 * duelLifecycle is broken by construction:
 *   1. turnTimers = createTurnTimerRegistry({ timeoutMs })
 *   2. reconnectTimers = createReconnectTimerRegistry({ graceMs }) — pass-through
 *   3. bracketWalkoverTimers — RECEIVED (injected arg), never context-owned
 *   4. phaseStore = createPhaseStore(); roundState = createRoundStateStore()
 *   5. turnCycle = createTurnCycle({ bracketWalkoverTimers, roundState, phaseStore })
 *   6. lifecycle = createDuelLifecycle({ turnTimers, turnCycle, duelRoundState: roundState, phaseStore })
 *   7. turnCycle.bindLifecycle(lifecycle) — one-shot setter (two-phase init)
 */
import { createPhaseStore } from '../engine/duelPhaseStore.js';
import { createRoundStateStore } from './duelRoundState.js';
import { createTurnTimerRegistry } from './turnTimers.js';
import { createReconnectTimerRegistry } from './reconnectTimers.js';
import { createTurnCycle } from './turnCycle.js';
import { createDuelLifecycle } from './duelLifecycle.js';

/**
 * @param {{
 *   turnTimeoutMs?: number,
 *   reconnectGraceMs?: number,
 *   bracketWalkoverTimers: object,
 * }} opts
 * @returns {{
 *   turnTimers: object,
 *   reconnectTimers: object,
 *   bracketWalkoverTimers: object,
 *   phaseStore: object,
 *   roundState: object,
 *   turnCycle: object,
 *   lifecycle: object,
 * }}
 */
export function createDuelContext({ turnTimeoutMs, reconnectGraceMs, bracketWalkoverTimers }) {
  const turnTimers = createTurnTimerRegistry({ timeoutMs: turnTimeoutMs });
  const reconnectTimers = createReconnectTimerRegistry({ graceMs: reconnectGraceMs });
  const phaseStore = createPhaseStore();
  const roundState = createRoundStateStore();
  const turnCycle = createTurnCycle({ bracketWalkoverTimers, roundState, phaseStore });
  const lifecycle = createDuelLifecycle({
    turnTimers,
    turnCycle,
    duelRoundState: roundState,
    phaseStore,
  });
  // Two-phase init: bind AFTER the lifecycle exists. Guaranteed to run before
  // any turn can resolve — no TDZ, no load-order fragility (design Q4).
  turnCycle.bindLifecycle(lifecycle);

  return {
    turnTimers,
    reconnectTimers,
    bracketWalkoverTimers,
    phaseStore,
    roundState,
    turnCycle,
    lifecycle,
  };
}
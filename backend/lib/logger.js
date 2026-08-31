import pino from 'pino';

/**
 * Structured JSON logger (spec R4, deliverable 4 of item #17). Standalone
 * module: imports ONLY pino — zero coupling to duel/room/WS state, so the
 * unmerged phase-3 stack (which relocates ws/*Timers.js and server.js) only
 * needs to carry the one-line `import { logger }` with no logic conflicts.
 *
 * - `level` comes from LOG_LEVEL (default "info").
 * - Native pino `redact` censors sessionToken/nickname at top level and one
 *   level deep, plus the REST Authorization header — cleartext never reaches
 *   the output. Add `players[*].nickname` / `ranking[*].nickname` at any call
 *   site that logs those arrays.
 * - `createLogger(opts)` accepts an injectable `destination` stream for tests
 *   and any pino option override (e.g. `level`).
 */
export function createLogger(opts = {}) {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: [
          'sessionToken',
          '*.sessionToken',
          'nickname',
          '*.nickname',
          'req.headers.authorization',
        ],
        censor: '[REDACTED]',
      },
      ...opts,
    },
    opts.destination,
  );
}

/** Process-wide logger (composition root default). */
export const logger = createLogger();

/**
 * Child-logger helper for correlation bindings (reqId, socketId, playerId,
 * roomId/roomCode, duelId, round): every line from the child carries them.
 */
export const child = (bindings) => logger.child(bindings);
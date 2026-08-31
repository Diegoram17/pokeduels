import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createSocketServer } from './ws/index.js';
import { pool, closePool } from './db/pool.js';
import { reconcileOrphanedDuels, reconcileStaleWaitingRooms } from './db/reconciliation.js';
import { loadTypeEffectivenessCache } from './engine/typeEffectiveness.js';
import { logger } from './lib/logger.js';

const port = process.env.PORT ?? 3000;

// Module-scoped so the shutdown handler can reach the listeners created inside
// start() (they are not defined until boot completes).
let httpServer;
let io;

let closing = false;

/**
 * Graceful shutdown (item #17, deliverable 3): drains the HTTP/Socket.IO
 * listeners and the shared pg pool exactly once, then exits 0. Render sends
 * SIGTERM on every deploy; without this handler in-flight queries were killed
 * and pool sockets leaked until the process was force-killed. Exported so
 * tests (win32 cannot deliver POSIX signals) and phase-3's F7 drain can reuse
 * the same path.
 *
 * @param {string} [signal] - 'SIGTERM' | 'SIGINT' (informational)
 */
export async function shutdown(signal = 'SIGTERM') {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutting down');
  httpServer?.close();
  io?.close();
  try {
    await closePool();
  } catch (err) {
    logger.error({ err }, 'pool.end() failed');
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function start() {
  // The duel engine resolves rounds through the in-memory type-effectiveness
  // matrix (324 rows, engine/typeEffectiveness.js). It must be loaded once at
  // boot — the first item-#5 round would otherwise fault inside resolverRonda.
  await loadTypeEffectivenessCache(pool);

  // Shared http.Server so the Socket.IO layer (createSocketServer) attaches to
  // the same listener as the Express app.
  const app = createApp();
  httpServer = createServer(app);
  ({ io } = createSocketServer(httpServer, { corsOrigin: process.env.CORS_ORIGIN }));

  // Make io available to route handlers (used by bot endpoints to broadcast room state)
  app.set('io', io);

  // Boot-time orphan reconciliation (ADR-0008): a crash mid-duel must not
  // leave duels/rooms stuck in_progress. Awaited strictly before .listen() so
  // no client can connect to unreconciled state. Errors propagate (fail
  // closed) — a reconciliation failure aborts boot via the catch below.
  await reconcileOrphanedDuels();
  await reconcileStaleWaitingRooms();

  httpServer.listen(port, () => {
    logger.info({ port }, 'pokeduels API listening');
  });
}

start().catch((err) => {
  logger.error({ err }, 'failed to start pokeduels API');
  process.exit(1);
});
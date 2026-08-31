import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createSocketServer } from './ws/index.js';
import { pool, closePool } from './db/pool.js';
import { reconcileOrphanedDuels, reconcileStaleWaitingRooms } from './db/reconciliation.js';
import { loadTypeEffectivenessCache } from './engine/typeEffectiveness.js';

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
  console.log(`pokeduels API shutting down (${signal})`);
  httpServer?.close();
  io?.close();
  try {
    await closePool();
  } catch (err) {
    console.error(`pool.end() failed: ${err.message}`, err);
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
    console.log(`pokeduels API listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error(`failed to start pokeduels API: ${err.message}`, err);
  process.exit(1);
});
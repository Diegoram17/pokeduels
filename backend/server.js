import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createSocketServer } from './ws/index.js';
import { pool } from './db/pool.js';
import { reconcileOrphanedDuels } from './db/reconciliation.js';
import { loadTypeEffectivenessCache } from './engine/typeEffectiveness.js';

const port = process.env.PORT ?? 3000;

async function start() {
  // The duel engine resolves rounds through the in-memory type-effectiveness
  // matrix (324 rows, engine/typeEffectiveness.js). It must be loaded once at
  // boot — the first item-#5 round would otherwise fault inside resolverRonda.
  await loadTypeEffectivenessCache(pool);

  // Shared http.Server so the Socket.IO layer (createSocketServer) attaches to
  // the same listener as the Express app.
  const httpServer = createServer(createApp());
  createSocketServer(httpServer);

  // Boot-time orphan reconciliation (ADR-0008): a crash mid-duel must not
  // leave duels/rooms stuck in_progress. Awaited strictly before .listen() so
  // no client can connect to unreconciled state. Errors propagate (fail
  // closed) — a reconciliation failure aborts boot via the catch below.
  await reconcileOrphanedDuels();

  httpServer.listen(port, () => {
    console.log(`pokeduels API listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error(`failed to start pokeduels API: ${err.message}`, err);
  process.exit(1);
});
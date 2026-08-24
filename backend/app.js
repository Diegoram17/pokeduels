import express from 'express';
import cors from 'cors';
import { sessionRouter } from './routes/session.js';
import { catalogRouter } from './routes/catalog.js';
import { createRoomsRouter } from './routes/rooms.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createSessionLimiter } from './middleware/rateLimit.js';

/**
 * createApp() factory — returns a fresh express instance (and fresh
 * rate-limiter instances) so tests get isolated app + limiter state per
 * test, and server.js stays the only caller of .listen().
 */
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Session issuance is rate-limited per client IP (10/min).
  app.use('/api/session', createSessionLimiter(), sessionRouter);
  app.use('/api', catalogRouter);

  // Rooms lobby: GET is public; POST is rate-limited + authenticated inside
  // createRoomsRouter() (limiter runs before auth, design decision). The
  // factory keeps limiter state per app instance.
  app.use('/api/rooms', createRoomsRouter());

  // Liveness probe (ADR-0006): bare 200, empty body, zero DB access — so an
  // external cron can keep the free-tier instance warm. Mounted BEFORE the
  // 404 catch-all.
  app.get('/health', (req, res) => {
    res.status(200).end();
  });

  // Unknown routes → 404 JSON.
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Central error handler must be mounted last (4-arg middleware).
  app.use(errorHandler);

  return app;
}
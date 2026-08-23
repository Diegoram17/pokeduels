import rateLimit from 'express-rate-limit';

// Factories returning FRESH limiter instances so createApp() gives each app
// isolated in-memory counters (no leakage across test files/processes).
// Per-IP, in-memory store.

export function createSessionLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
  });
}

export function createRoomCreateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
  });
}
import { HttpError } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';

// pg SQLSTATE → HTTP status. Kept in one place so the mapping is reviewable.
// 22P02 invalid text representation (e.g. malformed UUID in session_token)
// 23503 foreign key violation
// 23505 unique violation
// 23514 check violation
const PG_STATUS_MAP = {
  '22P02': 400,
  '23503': 400,
  '23505': 409,
  '23514': 400,
};

/**
 * Pure mapping used by the error middleware (exported for unit testing).
 */
export function statusForError(err) {
  if (err instanceof HttpError) return err.statusCode;
  if (err && typeof err.code === 'string' && PG_STATUS_MAP[err.code]) {
    return PG_STATUS_MAP[err.code];
  }
  return 500;
}

/**
 * Central error handler — mounted last in createApp(). Maps HttpError and
 * known pg SQLSTATEs to 4xx JSON; anything else becomes a logged 500.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = statusForError(err);
  if (status === 500) {
    logger.error({ err }, 'unhandled error');
  }
  const body = { error: status === 500 ? 'Internal Server Error' : err.message };
  if (err instanceof HttpError && err.details !== undefined) {
    body.details = err.details;
  }
  res.status(status).json(body);
}
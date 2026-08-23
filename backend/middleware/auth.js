import { HttpError } from '../lib/httpError.js';
import { touchSession } from '../db/players.js';

const BEARER_RE = /^Bearer (.+)$/;

/**
 * requireAuth — resolves `Authorization: Bearer <sessionToken>` to a player
 * row (one round trip does lookup + last_seen_at touch via touchSession) and
 * attaches `req.player = { id, nickname }`. Missing/malformed headers, unknown
 * tokens, and non-UUID tokens all become 401; nothing is written.
 *
 * Note: a malformed UUID raises pg 22P02, which the central errorHandler maps
 * to 400 globally — the SPEC requires 401 for malformed tokens, so the 22P02
 * case is caught here and re-raised as HttpError(401).
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? header.match(BEARER_RE) : null;
    if (!match) {
      throw new HttpError(401, 'missing or malformed Authorization header');
    }

    let player;
    try {
      player = await touchSession(match[1]);
    } catch (err) {
      if (err && err.code === '22P02') {
        throw new HttpError(401, 'invalid session token');
      }
      throw err;
    }

    if (!player) {
      throw new HttpError(401, 'invalid session token');
    }

    req.player = { id: player.id, nickname: player.nickname };
    next();
  } catch (err) {
    next(err);
  }
}
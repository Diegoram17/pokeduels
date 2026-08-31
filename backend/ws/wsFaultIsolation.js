import { WsError } from '../lib/wsError.js';
import { logger } from '../lib/logger.js';

/**
 * Per-socket fault isolation for the WS lobby (mirrors engine/faultIsolation.js
 * under ADR-0001's single-process model): one socket handler failing must
 * never crash the shared process or affect other sockets.
 *
 * WsError is a domain rejection carrying the event/payload to emit back to
 * the client (e.g. team:starter_rejected). Anything else is a genuine fault:
 * logged loudly server-side and swallowed — the client gets no event and the
 * process keeps running.
 *
 * @param {import('socket.io').Socket} socket
 * @param {() => Promise<any>} fn - the per-event work
 * @returns {Promise<any>} fn's result on success, undefined on error
 */
export async function withWsHandler(socket, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof WsError) {
      if (err.payload !== undefined) socket.emit(err.event, err.payload);
      else socket.emit(err.event);
      return undefined;
    }
    logger.error({ err }, 'ws handler fault');
    return undefined;
  }
}
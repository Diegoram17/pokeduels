/**
 * WsError — application-level error carrying a Socket.IO event name and an
 * optional structured payload. WS handler code throws it for validation/domain
 * failures; the withWsHandler wrapper maps it to socket.emit(event, payload).
 * Parallel to HttpError (lib/httpError.js) for the REST layer.
 */
export class WsError extends Error {
  constructor(event, payload) {
    super(event);
    this.name = 'WsError';
    this.event = event;
    if (payload !== undefined) this.payload = payload;
  }
}
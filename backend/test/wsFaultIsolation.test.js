import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsError } from '../lib/wsError.js';
import { withWsHandler } from '../ws/wsFaultIsolation.js';

// withWsHandler is the WS analogue of engine/faultIsolation.js: WsError is a
// domain rejection and is mapped to socket.emit(event, payload); anything
// else is a genuine fault, logged loudly and swallowed so a single socket's
// handler can never take down the shared process (ADR-0001).
describe('withWsHandler', () => {
  let socket;
  let errorSpy;

  beforeEach(() => {
    socket = { emit: vi.fn() };
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('emits the WsError event and payload to the socket without rethrowing', async () => {
    const err = new WsError('team:starter_rejected', { pokemonId: 25, reason: 'taken' });

    await expect(
      withWsHandler(socket, async () => {
        throw err;
      }),
    ).resolves.toBeUndefined();

    expect(socket.emit).toHaveBeenCalledWith('team:starter_rejected', { pokemonId: 25, reason: 'taken' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('emits only the event name when the WsError has no payload', async () => {
    const err = new WsError('room:rejected');

    await withWsHandler(socket, async () => {
      throw err;
    });

    expect(socket.emit).toHaveBeenCalledWith('room:rejected');
  });

  it('logs non-WsError faults and swallows them (no emit, no rethrow)', async () => {
    const boom = new Error('pg exploded');

    await expect(
      withWsHandler(socket, async () => {
        throw boom;
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns the handler result on success and emits nothing', async () => {
    const result = await withWsHandler(socket, async () => 'ok');
    expect(result).toBe('ok');
    expect(socket.emit).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
import { describe, it, expect } from 'vitest';
import { WsError } from '../lib/wsError.js';

describe('WsError', () => {
  it('extends Error and carries event + payload', () => {
    const err = new WsError('team:starter_rejected', { pokemonId: 25, reason: 'taken' });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WsError);
    expect(err.name).toBe('WsError');
    expect(err.event).toBe('team:starter_rejected');
    expect(err.payload).toEqual({ pokemonId: 25, reason: 'taken' });
  });

  it('omits payload when not provided', () => {
    const err = new WsError('room:rejected');
    expect(err.event).toBe('room:rejected');
    expect(err.payload).toBeUndefined();
  });
});
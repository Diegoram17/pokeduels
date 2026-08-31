import { describe, it, expect } from 'vitest';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import pino from 'pino';

// Dependency presence + shape gate (PR 1 task 1.1): the WS layer in PR 2
// builds on socket.io's Server and socket.io-client's `io` connect helper.
// If either dependency is removed or its exports renamed, this file fails.
describe('socket.io dependencies', () => {
  it('socket.io exports a Server class', () => {
    expect(typeof Server).toBe('function');
  });

  it('socket.io-client exports an `io` connect function', () => {
    expect(typeof ioClient).toBe('function');
  });
});

describe('runtime logging dependency', () => {
  it('pino is a runtime dependency exposing a createLogger factory', () => {
    expect(typeof pino).toBe('function');
  });
});
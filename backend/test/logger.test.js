import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from '../lib/logger.js';

// Logger contract (spec R4): every call emits exactly one JSON line with at
// least { level, time, msg }; pino's native redact hides sessionToken/nickname
// at top level AND one level deep; child loggers bind correlation fields;
// LOG_LEVEL gates output. The destination is injectable for tests.
function capturingStream() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

describe('createLogger', () => {
  let capture;

  beforeEach(() => {
    capture = capturingStream();
  });

  it('emits a single parseable JSON line with level, time and msg', async () => {
    const logger = createLogger({ destination: capture.stream });

    logger.info('boot ok');
    await flush();

    expect(capture.lines).toHaveLength(1);
    const parsed = JSON.parse(capture.lines[0]);
    expect(parsed.msg).toBe('boot ok');
    expect(typeof parsed.level).toBe('number');
    expect(typeof parsed.time).toBe('number');
  });

  it('redacts sessionToken and nickname bindings and never leaks the cleartext', async () => {
    const logger = createLogger({ destination: capture.stream });

    logger.info({ sessionToken: 'super-secret-token', nickname: 'Ash' }, 'context');
    await flush();

    const parsed = JSON.parse(capture.lines[0]);
    expect(parsed.sessionToken).toBe('[REDACTED]');
    expect(parsed.nickname).toBe('[REDACTED]');
    expect(parsed.msg).toBe('context');
    // The cleartext must never appear anywhere in the emitted line.
    expect(capture.lines[0]).not.toContain('super-secret-token');
  });

  it('redacts nested sessionToken one level deep (*.sessionToken)', async () => {
    const logger = createLogger({ destination: capture.stream });

    logger.info({ player: { sessionToken: 'nested-token', nickname: 'Misty' } });
    await flush();

    const parsed = JSON.parse(capture.lines[0]);
    expect(parsed.player.sessionToken).toBe('[REDACTED]');
    expect(parsed.player.nickname).toBe('[REDACTED]');
    expect(capture.lines[0]).not.toContain('nested-token');
  });

  it('child loggers bind correlation fields to every line', async () => {
    const logger = createLogger({ destination: capture.stream });
    const childLogger = logger.child({ duelId: 42, round: 3 });

    childLogger.info('move resolved');
    childLogger.warn({ playerId: 7 }, 'slow round');
    await flush();

    expect(capture.lines).toHaveLength(2);
    for (const line of capture.lines) {
      const parsed = JSON.parse(line);
      expect(parsed.duelId).toBe(42);
      expect(parsed.round).toBe(3);
    }
    expect(JSON.parse(capture.lines[1]).playerId).toBe(7);
  });

  it('redacts the Authorization header path used by REST request logs', async () => {
    const logger = createLogger({ destination: capture.stream });

    logger.info({ req: { headers: { authorization: 'Bearer sekrit' } } });
    await flush();

    const parsed = JSON.parse(capture.lines[0]);
    expect(parsed.req.headers.authorization).toBe('[REDACTED]');
  });
});

describe('LOG_LEVEL env gating', () => {
  afterEach(() => {
    delete process.env.LOG_LEVEL;
  });

  it('silences info when LOG_LEVEL=warn but emits warn', async () => {
    process.env.LOG_LEVEL = 'warn';
    vi.resetModules();
    const fresh = await import('../lib/logger.js');
    const capture = capturingStream();
    const logger = fresh.createLogger({ destination: capture.stream });

    logger.info('should be hidden');
    logger.warn('should be visible');
    await flush();

    expect(capture.lines).toHaveLength(1);
    expect(JSON.parse(capture.lines[0]).msg).toBe('should be visible');
  });
});
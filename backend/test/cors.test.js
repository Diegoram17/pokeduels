import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

/**
 * Spec: pre-deploy hardening decision (2026-08-24) — the backend is about to
 * be exposed publicly (Render) and must stop accepting requests from any
 * origin. CORS_ORIGIN, when set, restricts the REST API to that single
 * origin; when unset (local dev/test), behavior stays permissive so nothing
 * else in the suite (or a dev running the app locally) needs the var.
 */
describe('CORS origin configuration', () => {
  const originalCorsOrigin = process.env.CORS_ORIGIN;

  afterEach(() => {
    if (originalCorsOrigin === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = originalCorsOrigin;
    }
  });

  it('reflects only the configured CORS_ORIGIN when set', async () => {
    process.env.CORS_ORIGIN = 'https://pokeduels.vercel.app';
    const app = createApp();

    const res = await request(app).get('/health').set('Origin', 'https://pokeduels.vercel.app');
    expect(res.headers['access-control-allow-origin']).toBe('https://pokeduels.vercel.app');
  });

  it('never reflects an arbitrary request origin when CORS_ORIGIN is set — always the configured value', async () => {
    // The `cors` package echoes the configured static origin verbatim
    // regardless of the request's actual Origin header; browsers are the
    // ones that refuse the response client-side when it doesn't match their
    // own origin. This proves the server stopped reflecting "*" (any
    // origin) and now only ever advertises the one trusted origin.
    process.env.CORS_ORIGIN = 'https://pokeduels.vercel.app';
    const app = createApp();

    const res = await request(app).get('/health').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://pokeduels.vercel.app');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('defaults to permissive (*) when CORS_ORIGIN is unset — dev/test convenience', async () => {
    delete process.env.CORS_ORIGIN;
    const app = createApp();

    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasDatabase } from './helpers.js';

const BACKEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const READY_TIMEOUT_MS = 15000;

/**
 * Approval test for the server.js bootstrap refactor (PR 1 task 1.5): the
 * HTTP server built from createApp() must boot and serve the REST API on the
 * configured port. Runs against the real `node server.js` entry point (not
 * createApp() directly), so it pins the listen/bootstrap behavior the
 * refactor must preserve.
 */
describe.skipIf(!hasDatabase)('server.js bootstrap (requires DATABASE_URL)', () => {
  let server;
  let port;
  let stderr = '';

  async function getFreePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, () => {
        const { port: p } = srv.address();
        srv.close(() => resolve(p));
      });
      srv.on('error', reject);
    });
  }

  async function waitUntilReady(url) {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url);
        return res; // any HTTP response proves the server is listening
      } catch {
        // server not up yet — keep polling
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`server did not become ready within ${READY_TIMEOUT_MS}ms; stderr: ${stderr}`);
  }

  beforeAll(async () => {
    port = await getFreePort();
    server = spawn(process.execPath, ['server.js'], {
      cwd: BACKEND_DIR,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    server.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
  });

  afterAll(async () => {
    if (server && !server.killed) {
      server.kill();
    }
    await new Promise((r) => setTimeout(r, 100));
  });

  it('serves the public pokemons endpoint over HTTP', async () => {
    const res = await waitUntilReady(`http://127.0.0.1:${port}/api/pokemons`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('returns 404 JSON for an unknown route', async () => {
    const res = await waitUntilReady(`http://127.0.0.1:${port}/api/does-not-exist`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not Found');
  });
});
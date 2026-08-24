import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { createRoomWithCreator } from '../db/rooms.js';
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
  let orphanRoomId;
  let orphanPlayerIds = [];

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

    // Seed an orphaned in-progress duel + its room BEFORE the server boots
    // (ADR-0008): the boot-time reconciliation must sweep it before the
    // server accepts any traffic.
    const creator = await createPlayer('BootReconCreator');
    const joiner = await createPlayer('BootReconJoiner');
    orphanPlayerIds = [creator.id, joiner.id];
    const room = await createRoomWithCreator(2, creator.id);
    orphanRoomId = room.id;
    await pool.query("UPDATE rooms SET status = 'in_progress' WHERE id = $1", [room.id]);
    await pool.query(
      `INSERT INTO duels (room_id, player1_id, player2_id, round, status, winner_id, end_reason)
       VALUES ($1, $2, $3, 'unica', 'in_progress', NULL, NULL)`,
      [room.id, creator.id, joiner.id],
    );

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
    if (orphanRoomId) {
      await pool.query('DELETE FROM rooms WHERE id = $1', [orphanRoomId]);
    }
    if (orphanPlayerIds.length) {
      await pool.query('DELETE FROM players WHERE id = ANY($1::int[])', [orphanPlayerIds]);
    }
    await pool.end();
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

  it('reconciles the pre-seeded orphaned duel and room before serving traffic', async () => {
    // The server has been up since beforeAll; the seeded in_progress duel must
    // have been swept at boot (server_restart), its room aborted.
    const { rows: duels } = await pool.query(
      'SELECT status, end_reason, winner_id FROM duels WHERE room_id = $1',
      [orphanRoomId],
    );
    expect(duels).toHaveLength(1);
    expect(duels[0].status).toBe('finished');
    expect(duels[0].end_reason).toBe('server_restart');
    expect(duels[0].winner_id).toBeNull();

    const { rows: rooms } = await pool.query(
      'SELECT status FROM rooms WHERE id = $1',
      [orphanRoomId],
    );
    expect(rooms[0].status).toBe('aborted');
  });

  it('serves GET /health with an empty 200 body', async () => {
    const res = await waitUntilReady(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('');
  });
});
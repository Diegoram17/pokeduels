import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

// Load .env file and parse it into environment variables
function loadEnv() {
  try {
    const envContent = readFileSync('.env', 'utf-8');
    const env = {};
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          env[match[1]] = match[2];
        }
      }
    }
    return env;
  } catch {
    return {};
  }
}

const envVars = loadEnv();

// Real-Neon integration suite: every DB test file self-provisions (migrate up
// + seed in beforeAll) and integration.test.js ends with `migrate down`.
// Parallel file execution would race those migrations on the shared database,
// so files must run sequentially. Long hook timeout covers the ~2min seed.
export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 600000,
    testTimeout: 30000,
    env: envVars,
  },
});
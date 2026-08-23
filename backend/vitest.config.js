import { defineConfig } from 'vitest/config';

// Real-Neon integration suite: every DB test file self-provisions (migrate up
// + seed in beforeAll) and integration.test.js ends with `migrate down`.
// Parallel file execution would race those migrations on the shared database,
// so files must run sequentially. Long hook timeout covers the ~2min seed.
export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 600000,
    testTimeout: 30000,
  },
});
import { describe, it, expect } from 'vitest';
import { assertDestructiveDbAllowed, PROD_DB_HOST_MARKERS } from './helpers.js';

// Destructive-op guard (spec R7c, deliverable 7 of item #17): the test
// bootstrap must refuse migrate-down / re-seed unless the target is a
// throwaway DB, signaled by ALLOW_DESTRUCTIVE_DB_TESTS=1. The production-host
// denylist (PROD_DB_HOST_MARKERS) may ship EMPTY — Neon `ep-` hostnames carry
// a random id, not the branch name — in which case the flag alone is the
// primary signal (ADR-0012).
describe('assertDestructiveDbAllowed', () => {
  it('throws naming ALLOW_DESTRUCTIVE_DB_TESTS when the flag is unset', () => {
    expect(() => assertDestructiveDbAllowed({})).toThrow(/ALLOW_DESTRUCTIVE_DB_TESTS/);
  });

  it('throws when the flag is present but not "1"', () => {
    expect(() => assertDestructiveDbAllowed({ ALLOW_DESTRUCTIVE_DB_TESTS: '0' })).toThrow(
      /ALLOW_DESTRUCTIVE_DB_TESTS/,
    );
    expect(() => assertDestructiveDbAllowed({ ALLOW_DESTRUCTIVE_DB_TESTS: 'true' })).toThrow(
      /ALLOW_DESTRUCTIVE_DB_TESTS/,
    );
  });

  it('returns undefined when ALLOW_DESTRUCTIVE_DB_TESTS=1 (throwaway target)', () => {
    expect(assertDestructiveDbAllowed({ ALLOW_DESTRUCTIVE_DB_TESTS: '1' })).toBeUndefined();
  });

  it('names the remediation steps in the error message', () => {
    let message = '';
    try {
      assertDestructiveDbAllowed({});
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain('Neon dev branch');
    expect(message).toContain('ALLOW_DESTRUCTIVE_DB_TESTS=1');
    expect(message).toContain('ADR-0012');
  });

  it('exposes PROD_DB_HOST_MARKERS as a denylist array (may ship empty)', () => {
    expect(Array.isArray(PROD_DB_HOST_MARKERS)).toBe(true);
  });

  // Activates automatically once a non-secret production-host marker is
  // committed; skipped while the denylist ships empty (flag-only guard).
  describe.skipIf(PROD_DB_HOST_MARKERS.length === 0)('production host denylist', () => {
    it('throws even with the flag when DATABASE_URL matches a marker', () => {
      expect(() =>
        assertDestructiveDbAllowed({
          ALLOW_DESTRUCTIVE_DB_TESTS: '1',
          DATABASE_URL: `postgres://user:pass@${PROD_DB_HOST_MARKERS[0]}/dbname`,
        }),
      ).toThrow(/production host marker/i);
    });
  });
});
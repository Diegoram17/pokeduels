import { describe, it, expect } from 'vitest';
import { sanitizeNickname } from '../lib/sanitizeNickname.js';

// Nickname sanitizer contract (spec R1): normalize FIRST (trim → collapse
// internal whitespace runs → NFC), THEN validate (empty / length ∉ [3,30] /
// Unicode Cc+Cf). Charset is MODERATE: any printable letter/number/mark/
// punctuation/symbol/emoji passes; control + format chars are rejected.
describe('sanitizeNickname', () => {
  it('trims outer whitespace and collapses internal runs to a single space', () => {
    expect(sanitizeNickname('  Ash   Ketchum  ')).toEqual({
      ok: true,
      value: 'Ash Ketchum',
    });
  });

  it('collapses tabs/newlines inside the name to a single space', () => {
    expect(sanitizeNickname('Ash\tKetchum\nJr')).toEqual({
      ok: true,
      value: 'Ash Ketchum Jr',
    });
  });

  it('composes Unicode NFD input to NFC and measures length on the composed form', () => {
    // "Cafe\u0301" is 5 code points in NFD; the composed "Café" is 4. The
    // persisted value must be the NFC form and the length gate must use it.
    const result = sanitizeNickname('Cafe\u0301');
    expect(result).toEqual({ ok: true, value: 'Caf\u00e9' });
    expect([...result.value].length).toBe(4);
  });

  it('rejects a 2-character nickname as too_short', () => {
    expect(sanitizeNickname('ab')).toEqual({ ok: false, error: 'too_short' });
  });

  it('accepts exactly 3 characters and rejects 31 as too_long', () => {
    expect(sanitizeNickname('abc')).toEqual({ ok: true, value: 'abc' });
    expect(sanitizeNickname('n'.repeat(31))).toEqual({ ok: false, error: 'too_long' });
  });

  it('accepts exactly 30 characters (VARCHAR(30) boundary)', () => {
    expect(sanitizeNickname('n'.repeat(30))).toEqual({ ok: true, value: 'n'.repeat(30) });
  });

  it('rejects control characters (C0, zero-width, bidi override)', () => {
    expect(sanitizeNickname('Ash\u0000Ketchum')).toEqual({ ok: false, error: 'control_chars' });
    expect(sanitizeNickname('Ash\u200bKetchum')).toEqual({ ok: false, error: 'control_chars' });
    expect(sanitizeNickname('Ash\u202eKetchum')).toEqual({ ok: false, error: 'control_chars' });
  });

  it('rejects a whitespace-only name as empty after normalization', () => {
    expect(sanitizeNickname('   ')).toEqual({ ok: false, error: 'empty' });
    expect(sanitizeNickname('\t\n ')).toEqual({ ok: false, error: 'empty' });
  });

  it('accepts emoji and non-Latin script (MODERATE charset)', () => {
    expect(sanitizeNickname('Ash\u26a1')).toEqual({ ok: true, value: 'Ash\u26a1' });
    expect(sanitizeNickname('\u30b5\u30c8\u30b7')).toEqual({ ok: true, value: '\u30b5\u30c8\u30b7' });
    expect(sanitizeNickname('\ud83d\udd25\ud83d\udd25\ud83d\udd25')).toEqual({
      ok: true,
      value: '\ud83d\udd25\ud83d\udd25\ud83d\udd25',
    });
  });

  it('rejects non-string input as invalid_type', () => {
    expect(sanitizeNickname(42)).toEqual({ ok: false, error: 'invalid_type' });
    expect(sanitizeNickname(null)).toEqual({ ok: false, error: 'invalid_type' });
    expect(sanitizeNickname(undefined)).toEqual({ ok: false, error: 'invalid_type' });
    expect(sanitizeNickname({})).toEqual({ ok: false, error: 'invalid_type' });
  });
});
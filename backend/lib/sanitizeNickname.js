/**
 * sanitizeNickname — the single shared nickname normalizer + validator for the
 * backend (spec R1, deliverable 1 of item #17). Pure and dependency-free.
 *
 * Normalization is SILENT and runs in this exact order:
 *   1. trim outer whitespace
 *   2. collapse every internal whitespace run to a single U+0020
 *   3. apply Unicode NFC (compose combining marks)
 *
 * Validation runs on the NORMALIZED value and rejects with a machine code:
 *   - `empty`        — nothing left after normalization
 *   - `too_short`    — fewer than 3 code points
 *   - `too_long`     — more than 30 code points (PG VARCHAR(30) semantics)
 *   - `control_chars`— any Unicode Cc/Cf character (C0/C1 controls, DEL,
 *                      zero-width U+200B-200D, bidi overrides U+202A-202E /
 *                      2066-2069, soft hyphen). Tab/newline/BOM already became
 *                      spaces in step 2, so they never reach this check.
 *   - `invalid_type` — input is not a string
 *
 * Charset policy is MODERATE: any printable letter, number, mark, punctuation,
 * symbol, or emoji passes; only control/format characters are rejected.
 * Length is measured on Unicode code points (`[...value].length`), matching
 * Postgres character counting and the emoji allowance.
 *
 * Call sites map the result to their transport: REST throws HttpError(400),
 * WS throws WsError('room:join_rejected', { reason: 'invalid_nickname' }).
 * The `room_players.nickname` copy (db/rooms.js) trusts the already-sanitized
 * `players.nickname` and never sanitizes again.
 *
 * @param {unknown} input - candidate nickname from a request body/payload
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function sanitizeNickname(input) {
  if (typeof input !== 'string') return { ok: false, error: 'invalid_type' };

  let value = input.trim();
  value = value.replace(/\s+/gu, ' ');
  value = value.normalize('NFC');

  if (/[\p{Cc}\p{Cf}]/u.test(value)) return { ok: false, error: 'control_chars' };

  const length = [...value].length;
  if (length === 0) return { ok: false, error: 'empty' };
  if (length < 3) return { ok: false, error: 'too_short' };
  if (length > 30) return { ok: false, error: 'too_long' };

  return { ok: true, value };
}
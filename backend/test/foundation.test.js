import { describe, it, expect, vi } from 'vitest';
import { HttpError } from '../lib/httpError.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { generateRoomCode } from '../lib/roomCode.js';
import { statusForError } from '../middleware/errorHandler.js';

describe('HttpError', () => {
  it('carries statusCode and message and is an Error', () => {
    const err = new HttpError(400, 'nickname is required');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('nickname is required');
  });

  it('carries optional details when provided', () => {
    const err = new HttpError(409, 'duplicate', { field: 'nickname' });
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ field: 'nickname' });
  });
});

describe('asyncHandler', () => {
  const req = {};
  const res = {};

  it('forwards a rejected promise to next with the error', async () => {
    const next = vi.fn();
    const boom = new Error('boom');
    const wrapped = asyncHandler(async () => {
      throw boom;
    });
    await wrapped(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
  });

  it('forwards a synchronously thrown error to next', async () => {
    const next = vi.fn();
    const boom = new Error('sync boom');
    const wrapped = asyncHandler(() => {
      throw boom;
    });
    await wrapped(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
  });

  it('does not call next when the handler resolves', async () => {
    const next = vi.fn();
    const wrapped = asyncHandler(async () => 'ok');
    await wrapped(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('generateRoomCode', () => {
  it('returns a 6-character code using only the unambiguous charset', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it('never produces the excluded characters 0, O, 1, I', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateRoomCode();
      expect(code).not.toMatch(/[0O1I]/);
    }
  });

  it('produces distinct codes across many draws', () => {
    const codes = new Set();
    for (let i = 0; i < 200; i += 1) codes.add(generateRoomCode());
    expect(codes.size).toBe(200);
  });
});

describe('statusForError', () => {
  it('maps HttpError to its own statusCode', () => {
    expect(statusForError(new HttpError(400, 'x'))).toBe(400);
    expect(statusForError(new HttpError(409, 'x'))).toBe(409);
  });

  it('maps pg invalid-text-representation 22P02 to 400', () => {
    expect(statusForError({ code: '22P02' })).toBe(400);
  });

  it('maps pg foreign-key violation 23503 to 400', () => {
    expect(statusForError({ code: '23503' })).toBe(400);
  });

  it('maps pg unique violation 23505 to 409', () => {
    expect(statusForError({ code: '23505' })).toBe(409);
  });

  it('maps pg check violation 23514 to 400', () => {
    expect(statusForError({ code: '23514' })).toBe(400);
  });

  it('falls back to 500 for unknown pg codes and plain errors', () => {
    expect(statusForError({ code: 'XX000' })).toBe(500);
    expect(statusForError(new Error('boom'))).toBe(500);
  });
});
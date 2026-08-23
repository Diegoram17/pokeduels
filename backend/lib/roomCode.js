import { randomBytes } from 'node:crypto';

// 32 unambiguous characters: excludes 0/O and 1/I so join codes can be
// dictated and typed without confusion. 32 divides 256 evenly, so
// `byte % 32` is unbiased (no modulo bias).
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export function generateRoomCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += CHARSET[byte % CHARSET.length];
  }
  return code;
}
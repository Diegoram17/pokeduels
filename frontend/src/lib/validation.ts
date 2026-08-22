// Nickname validation for the login screen (RF-1.1): 3–20 characters after
// trimming surrounding whitespace. Returns a user-facing error message or
// null when the nickname is acceptable.

export const MIN_NICKNAME_LENGTH = 3
export const MAX_NICKNAME_LENGTH = 20

export function validateNickname(raw: string): string | null {
  const value = raw.trim()
  if (value.length < MIN_NICKNAME_LENGTH) {
    return `El apodo debe tener al menos ${MIN_NICKNAME_LENGTH} caracteres`
  }
  if (value.length > MAX_NICKNAME_LENGTH) {
    return `El apodo no puede superar los ${MAX_NICKNAME_LENGTH} caracteres`
  }
  return null
}
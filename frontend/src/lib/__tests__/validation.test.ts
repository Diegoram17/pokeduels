import { describe, it, expect } from 'vitest'
import { validateNickname } from '../validation'

describe('validateNickname', () => {
  it('accepts a nickname of 3 characters', () => {
    expect(validateNickname('Ash')).toBeNull()
  })

  it('accepts a nickname of exactly 20 characters', () => {
    expect(validateNickname('A'.repeat(20))).toBeNull()
  })

  it('trims surrounding whitespace before validating length', () => {
    expect(validateNickname('  Ash  ')).toBeNull()
  })

  it('rejects a nickname shorter than 3 characters after trimming', () => {
    const error = validateNickname(' Ab ')
    expect(error).not.toBeNull()
    expect(error).toContain('3')
  })

  it('rejects a nickname longer than 20 characters', () => {
    const error = validateNickname('A'.repeat(21))
    expect(error).not.toBeNull()
    expect(error).toContain('20')
  })

  it('rejects an empty or whitespace-only nickname', () => {
    expect(validateNickname('')).not.toBeNull()
    expect(validateNickname('   ')).not.toBeNull()
  })
})
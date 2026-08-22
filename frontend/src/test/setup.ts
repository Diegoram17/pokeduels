// Shared Vitest setup: extends matchers and guarantees React Testing Library
// cleanup after every test, regardless of environment (jsdom or node).
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
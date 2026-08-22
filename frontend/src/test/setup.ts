// Shared Vitest setup: extends matchers and guarantees React Testing Library
// cleanup after every test, regardless of environment (jsdom or node).
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  // jsdom keeps a single localStorage per test file; MockStateProvider hydrates
  // from it on mount, so state persisted by one test would leak into the next.
  if (typeof localStorage !== 'undefined') {
    localStorage.clear()
  }
})
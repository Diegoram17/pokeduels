import { useEffect } from 'react'
import type { MockState } from '../schema'
import { saveMockState } from '../store'

/**
 * Persists the mock state to localStorage on every change so it survives
 * reloads. Extracted from MockStateProvider (was the `[state]` effect); the
 * provider's dispatch path no longer double-writes.
 */
export function useMockPersistence(state: MockState): void {
  useEffect(() => {
    saveMockState(state)
  }, [state])
}
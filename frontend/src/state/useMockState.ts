import { useContext } from 'react'
import {
  MockStateContext,
  type MockStateActions,
  type MockStateContextValue,
} from './MockStateProvider'

/**
 * Typed access to the mock state store. Must be used inside a
 * <MockStateProvider>. Returns the [state, actions] tuple.
 */
export function useMockState(): MockStateContextValue {
  const ctx = useContext(MockStateContext)
  if (!ctx) {
    throw new Error('useMockState must be used within a MockStateProvider')
  }
  return ctx
}

export type { MockStateContextValue, MockStateActions }
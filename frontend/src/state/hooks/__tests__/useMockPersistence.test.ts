// @vitest-environment jsdom
// RED/GREEN tests for useMockPersistence: the [state] effect must persist the
// mock state to localStorage on mount and re-persist whenever the state object
// changes (the "persist on every change" intent relocated out of the provider).

import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createInitialState, serializeMockState, STORAGE_KEY } from '../../store'
import type { MockState } from '../../schema'
import { useMockPersistence } from '../useMockPersistence'

describe('useMockPersistence', () => {
  it('persists the current state on mount', () => {
    const state: MockState = createInitialState()
    renderHook(() => useMockPersistence(state))
    expect(localStorage.getItem(STORAGE_KEY)).toBe(serializeMockState(state))
  })

  it('re-persists a new blob whenever the state changes', () => {
    const first: MockState = createInitialState()
    const second: MockState = {
      ...createInitialState(),
      player: { nickname: 'Ash', playerId: 'p1', sessionToken: 'token-1' },
      room: {
        code: 'AB12',
        maxPlayers: 2,
        status: 'waiting',
        players: [{ playerId: 'p1', nickname: 'Ash', ready: false, connected: true }],
      },
    }
    const { rerender } = renderHook(
      (props: { state: MockState }) => useMockPersistence(props.state),
      { initialProps: { state: first } },
    )
    expect(localStorage.getItem(STORAGE_KEY)).toBe(serializeMockState(first))

    rerender({ state: second })
    expect(localStorage.getItem(STORAGE_KEY)).toBe(serializeMockState(second))
    expect(localStorage.getItem(STORAGE_KEY)).not.toBe(serializeMockState(first))
  })
})
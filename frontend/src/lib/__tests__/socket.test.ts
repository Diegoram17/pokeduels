import { describe, it, expect, vi, beforeEach } from 'vitest'
import { io } from 'socket.io-client'

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}))

import { connectSocket, disconnectSocket, getSocket } from '../socket'

function makeFakeSocket() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  disconnectSocket()
})

describe('connectSocket', () => {
  it('connects to the WS url passing the sessionToken as handshake auth', () => {
    const fakeSocket = makeFakeSocket()
    vi.mocked(io).mockReturnValue(fakeSocket as never)

    const socket = connectSocket('token-1')

    expect(socket).toBe(fakeSocket)
    expect(io).toHaveBeenCalledTimes(1)
    const [url, opts] = vi.mocked(io).mock.calls[0]
    expect(String(url)).toContain('http://localhost:3000')
    expect((opts as { auth: { sessionToken: string } }).auth.sessionToken).toBe('token-1')
  })

  it('returns the live socket via getSocket after connecting', () => {
    const fakeSocket = makeFakeSocket()
    vi.mocked(io).mockReturnValue(fakeSocket as never)

    connectSocket('token-1')

    expect(getSocket()).toBe(fakeSocket)
  })
})

describe('disconnectSocket', () => {
  it('disconnects the live socket and clears the module reference', () => {
    const fakeSocket = makeFakeSocket()
    vi.mocked(io).mockReturnValue(fakeSocket as never)
    connectSocket('token-1')

    disconnectSocket()

    expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1)
    expect(getSocket()).toBeNull()
  })

  it('is a safe no-op when no socket is connected', () => {
    expect(() => disconnectSocket()).not.toThrow()
    expect(getSocket()).toBeNull()
  })
})
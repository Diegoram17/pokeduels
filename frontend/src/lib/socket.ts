// Socket.IO client wrapper (#4 WS layer). The MockStateProvider owns the
// connection lifecycle (connect after sessionEstablished, disconnect on
// reset); screens reach the live socket through getSocket() to attach
// listeners and emit room/team events.

import { io, type Socket } from 'socket.io-client'

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'http://localhost:3000'

let socket: Socket | null = null

// Listener registry: screens subscribe before the provider's connect effect
// runs (child effects run before parent effects on mount), so listeners are
// held here and bound to the socket as soon as one exists.
const listeners = new Map<string, Set<(payload?: unknown) => void>>()

function bindListeners(target: Socket) {
  for (const [event, handlers] of listeners) {
    for (const handler of handlers) {
      target.on(event, handler)
    }
  }
}

/**
 * Registers a socket event handler regardless of connection state. The
 * handler is bound to the live socket when it connects and re-bound on
 * reconnect. Returns an unsubscribe function.
 */
export function onSocketEvent(
  event: string,
  handler: (payload?: unknown) => void,
): () => void {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(handler)
  socket?.on(event, handler)
  return () => {
    set?.delete(handler)
    socket?.off(event, handler)
  }
}

/**
 * Connects to the backend WS server authenticating with the stored session
 * token (socket.handshake.auth.sessionToken). Returns the live socket.
 */
export function connectSocket(token: string): Socket {
  socket = io(WS_URL, { auth: { sessionToken: token } })
  bindListeners(socket)
  return socket
}

/**
 * Disconnects the live socket and clears the module reference. Safe to call
 * when no socket is connected.
 */
export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
}

/**
 * Returns the live socket instance (null when not connected), so screens can
 * emit events without owning the connection.
 */
export function getSocket(): Socket | null {
  return socket
}
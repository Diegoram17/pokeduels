// REST client for the pokeduels backend (#2). Screens call these functions
// directly from their handlers/effects and dispatch synchronous state actions
// on success/failure (adapter pattern — zero async machinery in the reducer).

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

let sessionToken: string | null = null

export function setSessionToken(token: string | null): void {
  sessionToken = token
}

/**
 * Maps an error to the shared Spanish copy used by ErrorBanner (matches the
 * existing UI language). REST statuses map per the design's error table;
 * anything else (network failure, unknown status) gets a generic copy.
 */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Tu sesión expiró. Inicia sesión de nuevo.'
      case 404:
        return 'Sala no encontrada.'
      case 409:
        return 'La sala está llena u ocupada.'
      case 429:
        return 'Demasiadas solicitudes. Intenta de nuevo en un momento.'
      default:
        return 'Ocurrió un error del servidor.'
    }
  }
  return 'No se pudo conectar con el servidor.'
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`)
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'network error')
  }
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = (await res.json()) as { message?: string }
      if (body.message) message = body.message
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Endpoints (contracts verified against backend routes in this repo)
// ---------------------------------------------------------------------------

export interface SessionResult {
  playerId: string
  sessionToken: string
}

export function createSession(nickname: string): Promise<SessionResult> {
  return request<SessionResult>('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
  })
}

export interface Pokemon {
  id: number
  name: string
  type: string
  pokeapi_id: number
  sprite_url: string
  back_sprite_url: string
  is_starter: boolean
}

export function fetchCatalog(): Promise<Pokemon[]> {
  return request<Pokemon[]>('/api/pokemons')
}

export interface RoomSummary {
  id: string
  code: string
  max_players: 2 | 4
  status: 'waiting' | 'in_progress' | 'finished' | 'aborted'
  player_count: number
}

export function listRooms(): Promise<RoomSummary[]> {
  return request<RoomSummary[]>('/api/rooms')
}

export interface RoomShell {
  id: string
  code: string
  max_players: 2 | 4
  status: 'waiting' | 'in_progress' | 'finished' | 'aborted'
}

export function createRoom(maxPlayers: 2 | 4): Promise<RoomShell> {
  return request<RoomShell>('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_players: maxPlayers }),
  })
}

export function joinRoomByCode(code: string, nickname: string): Promise<RoomShell> {
  return request<RoomShell>(`/api/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
  })
}

export interface BotPlayer {
  id: string
  nickname: string
}

export function createBot(roomCode: string): Promise<BotPlayer> {
  return request<BotPlayer>(`/api/rooms/${roomCode}/bots`, {
    method: 'POST',
  })
}

export function removeBot(roomCode: string, botId: string): Promise<void> {
  return request<void>(`/api/rooms/${roomCode}/bots/${botId}`, {
    method: 'DELETE',
  })
}
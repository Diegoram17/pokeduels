import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ApiError,
  createSession,
  fetchCatalog,
  describeApiError,
  setSessionToken,
} from '../api'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  setSessionToken(null)
})

describe('createSession', () => {
  it('POSTs the trimmed nickname to /api/session and returns playerId + sessionToken', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, { playerId: 'player-1', sessionToken: 'token-1' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createSession('  Ash  ')

    expect(result).toEqual({ playerId: 'player-1', sessionToken: 'token-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/session')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ nickname: '  Ash  ' })
  })

  it('throws an ApiError carrying the status when the backend rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, { message: 'invalid session token' }),
      ),
    )

    const err = await createSession('Ash').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
  })
})

describe('fetchCatalog', () => {
  it('GETs /api/pokemons and returns the flat catalog array', async () => {
    const pokemons = [
      { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'x', back_sprite_url: 'x', is_starter: true },
    ]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, pokemons))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchCatalog()

    expect(result).toEqual(pokemons)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/pokemons')
  })

  it('attaches the Bearer token to requests once a session token is set', async () => {
    setSessionToken('token-abc')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCatalog()

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer token-abc')
  })

  it('surfaces network failures as an ApiError with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')))

    const err = await fetchCatalog().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
  })
})

describe('describeApiError', () => {
  it('maps each REST status to the shared Spanish copy', () => {
    expect(describeApiError(new ApiError(401, 'unauthorized'))).toContain('sesión')
    expect(describeApiError(new ApiError(404, 'room not found'))).toContain('no encontrada')
    expect(describeApiError(new ApiError(409, 'room is full'))).toContain('llena')
    expect(describeApiError(new ApiError(429, 'rate limited'))).toContain('Demasiadas solicitudes')
  })

  it('maps unknown statuses to a generic server error', () => {
    expect(describeApiError(new ApiError(500, 'boom'))).toContain('servidor')
  })

  it('maps non-ApiError failures to the connection error copy', () => {
    expect(describeApiError(new TypeError('failed to fetch'))).toContain('conectar')
  })
})
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  type Pokemon,
  filterCatalog,
  pokemonById,
  typeOptions,
  fetchCatalog,
  getCachedCatalog,
  setCachedCatalog,
} from '../catalog'

const catalog: Pokemon[] = [
  { id: 25, name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'front-pikachu', back_sprite_url: 'back-pikachu', is_starter: true },
  { id: 133, name: 'Eevee', type: 'normal', pokeapi_id: 133, sprite_url: 'front-eevee', back_sprite_url: 'back-eevee', is_starter: false },
  { id: 18, name: 'Pidgeot', type: 'flying', pokeapi_id: 18, sprite_url: 'front-pidgeot', back_sprite_url: 'back-pidgeot', is_starter: false },
  { id: 254, name: 'Sceptile', type: 'grass', pokeapi_id: 254, sprite_url: 'front-sceptile', back_sprite_url: 'back-sceptile', is_starter: false },
  { id: 68, name: 'Machamp', type: 'fighting', pokeapi_id: 68, sprite_url: 'front-machamp', back_sprite_url: 'back-machamp', is_starter: false },
  { id: 95, name: 'Onix', type: 'rock', pokeapi_id: 95, sprite_url: 'front-onix', back_sprite_url: 'back-onix', is_starter: false },
  { id: 94, name: 'Gengar', type: 'ghost', pokeapi_id: 94, sprite_url: 'front-gengar', back_sprite_url: 'back-gengar', is_starter: false },
]

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

beforeEach(() => {
  setCachedCatalog(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setCachedCatalog(null)
})

describe('typeOptions', () => {
  it('returns unique types sorted alphabetically', () => {
    expect(typeOptions(catalog)).toEqual([
      'electric',
      'fighting',
      'flying',
      'ghost',
      'grass',
      'normal',
      'rock',
    ])
  })
})

describe('filterCatalog', () => {
  it('returns every pokemon when no filters are applied', () => {
    expect(filterCatalog(catalog, '', 'all')).toHaveLength(7)
  })

  it('filters by case-insensitive name search', () => {
    const results = filterCatalog(catalog, 'mach', 'all')
    expect(results.map((p) => p.name)).toEqual(['Machamp'])
  })

  it('filters by exact type', () => {
    const results = filterCatalog(catalog, '', 'fire')
    expect(results).toEqual([])
    const ghosts = filterCatalog(catalog, '', 'ghost')
    expect(ghosts.map((p) => p.name)).toEqual(['Gengar'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterCatalog(catalog, 'zzz', 'all')).toEqual([])
  })
})

describe('pokemonById', () => {
  it('resolves a pokemon by its numeric backend id', () => {
    expect(pokemonById(catalog, 25)?.name).toBe('Pikachu')
    expect(pokemonById(catalog, 94)?.sprite_url).toBe('front-gengar')
  })

  it('returns undefined for an id that is not in the catalog', () => {
    expect(pokemonById(catalog, 999)).toBeUndefined()
  })

  it('returns undefined for an empty catalog', () => {
    expect(pokemonById([], 25)).toBeUndefined()
  })
})

describe('fetchCatalog', () => {
  it('fetches the flat catalog from GET /api/pokemons and caches the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, catalog))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchCatalog()

    expect(result).toEqual(catalog)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/pokemons')
    expect(getCachedCatalog()).toEqual(catalog)
  })

  it('returns the module cache without a second network call', async () => {
    setCachedCatalog(catalog)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchCatalog()

    expect(result).toEqual(catalog)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not cache when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')))

    await expect(fetchCatalog()).rejects.toThrow()

    expect(getCachedCatalog()).toBeNull()
  })
})
import { describe, it, expect } from 'vitest'
import type { PokemonSeed, SeedData } from '../../data/seedData'
import { filterCatalog, pokemonById, typeOptions } from '../catalog'

const catalog: PokemonSeed[] = [
  { name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { name: 'Pidgey', type: 'normal', pokeapi_id: 16, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { name: 'Charmeleon', type: 'fire', pokeapi_id: 5, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { name: 'Vulpix', type: 'fire', pokeapi_id: 37, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { name: 'Machop', type: 'fighting', pokeapi_id: 66, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
  { name: 'Abra', type: 'psychic', pokeapi_id: 63, sprite_url: 'x', back_sprite_url: 'x', is_starter: false },
]

const seedFixture: SeedData = {
  _meta: { version: '1', description: 'test', total_starters: 1, total_catalog: 3, notes: [] },
  starters: [
    { name: 'Pikachu', type: 'electric', pokeapi_id: 25, sprite_url: 'front-pikachu', back_sprite_url: 'back-pikachu', is_starter: true },
  ],
  catalog: [
    { name: 'Eevee', type: 'normal', pokeapi_id: 133, sprite_url: 'front-eevee', back_sprite_url: 'back-eevee', is_starter: false },
    { name: 'Gengar', type: 'ghost', pokeapi_id: 94, sprite_url: 'front-gengar', back_sprite_url: 'back-gengar', is_starter: false },
    { name: 'Machamp', type: 'fighting', pokeapi_id: 68, sprite_url: 'front-machamp', back_sprite_url: 'back-machamp', is_starter: false },
  ],
}

describe('typeOptions', () => {
  it('returns unique types sorted alphabetically', () => {
    expect(typeOptions(catalog)).toEqual(['fighting', 'fire', 'normal', 'psychic'])
  })
})

describe('filterCatalog', () => {
  it('returns every pokemon when no filters are applied', () => {
    expect(filterCatalog(catalog, '', 'all')).toHaveLength(6)
  })

  it('filters by case-insensitive name search', () => {
    const results = filterCatalog(catalog, 'char', 'all')
    expect(results.map((p) => p.name)).toEqual(['Charmeleon'])
  })

  it('filters by exact type', () => {
    const results = filterCatalog(catalog, '', 'fire')
    expect(results.map((p) => p.name)).toEqual(['Charmeleon', 'Vulpix'])
  })

  it('combines search and type filters', () => {
    const results = filterCatalog(catalog, 'vul', 'fire')
    expect(results.map((p) => p.name)).toEqual(['Vulpix'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterCatalog(catalog, 'zzz', 'all')).toEqual([])
  })
})

describe('pokemonById', () => {
  it('resolves a pokemon by its exact seed name across starters and catalog', () => {
    expect(pokemonById(seedFixture, 'Pikachu')?.back_sprite_url).toBe('back-pikachu')
    expect(pokemonById(seedFixture, 'Gengar')?.sprite_url).toBe('front-gengar')
  })

  it('resolves case-insensitively so lowercase roster ids still hit the catalog', () => {
    expect(pokemonById(seedFixture, 'pikachu')?.name).toBe('Pikachu')
    expect(pokemonById(seedFixture, 'EEVEE')?.name).toBe('Eevee')
  })

  it('returns undefined for a name that is not in the catalog', () => {
    expect(pokemonById(seedFixture, 'Rattata')).toBeUndefined()
  })

  it('returns undefined when no catalog has been loaded yet', () => {
    expect(pokemonById(null, 'Pikachu')).toBeUndefined()
  })
})
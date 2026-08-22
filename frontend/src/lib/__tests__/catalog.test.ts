import { describe, it, expect } from 'vitest'
import type { PokemonSeed } from '../../data/seedData'
import { filterCatalog, typeOptions } from '../catalog'

const catalog: PokemonSeed[] = [
  { name: 'Snorlax', type: 'normal', pokeapi_id: 143, sprite_url: 'x', is_starter: false },
  { name: 'Pidgey', type: 'normal', pokeapi_id: 16, sprite_url: 'x', is_starter: false },
  { name: 'Charmeleon', type: 'fire', pokeapi_id: 5, sprite_url: 'x', is_starter: false },
  { name: 'Vulpix', type: 'fire', pokeapi_id: 37, sprite_url: 'x', is_starter: false },
  { name: 'Machop', type: 'fighting', pokeapi_id: 66, sprite_url: 'x', is_starter: false },
  { name: 'Abra', type: 'psychic', pokeapi_id: 63, sprite_url: 'x', is_starter: false },
]

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
import type { PokemonSeed } from '../data/seedData'

// Catalog filtering helpers for the team-select screen: search by name and
// filter by type, plus the list of available types.

export const ALL_TYPES = 'all'

export function typeOptions(catalog: PokemonSeed[]): string[] {
  return [...new Set(catalog.map((pokemon) => pokemon.type))].sort()
}

export function filterCatalog(
  catalog: PokemonSeed[],
  search: string,
  type: string,
): PokemonSeed[] {
  const term = search.trim().toLowerCase()
  return catalog.filter((pokemon) => {
    const matchesSearch = term === '' || pokemon.name.toLowerCase().includes(term)
    const matchesType = type === ALL_TYPES || pokemon.type === type
    return matchesSearch && matchesType
  })
}
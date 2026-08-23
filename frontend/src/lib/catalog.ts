import type { PokemonSeed, SeedData } from '../data/seedData'

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

/**
 * Resolves a seed entry by its name, case-insensitively, across starters and
 * catalog. Duel rosters store the seed name as the pokemon id, so this is the
 * single lookup used to attach real sprite/type/name data at duel start.
 * Returns undefined when the catalog has not been loaded or the name is
 * unknown (the duel mock then keeps its stub shape for that slot).
 */
export function pokemonById(
  seed: SeedData | null,
  id: string,
): PokemonSeed | undefined {
  if (!seed) return undefined
  const wanted = id.trim().toLowerCase()
  for (const entry of [...seed.starters, ...seed.catalog]) {
    if (entry.name.toLowerCase() === wanted) return entry
  }
  return undefined
}
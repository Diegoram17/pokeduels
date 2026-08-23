// Catalog helpers for the team-select screen: search by name and filter by
// type, plus the list of available types. The catalog is the flat REST array
// served by GET /api/pokemons (#2); the backend numeric `id` is the canonical
// Pokémon identity (decision #1, obs #188). Names are resolved for display via
// pokemonById lookups only.
//
// The module-level cache replaces data/seedData.ts (getCachedSeedData /
// setCachedSeedData pattern reused verbatim); the catalog is NOT part of
// MockState/localStorage.

import { fetchCatalog as fetchCatalogFromApi } from './api'
import type { Pokemon } from './api'

export type { Pokemon }

export const ALL_TYPES = 'all'

let cache: Pokemon[] | null = null

/**
 * Synchronous access to the loaded catalog — used by the state store to
 * resolve real name/type/sprite data when a duel starts. Null until the first
 * fetchCatalog() resolves (the team-select screen always fetches before a
 * duel can begin, so the cache is warm in the real flow).
 */
export function getCachedCatalog(): Pokemon[] | null {
  return cache
}

/**
 * Replaces the cached catalog. Used by tests to seed a known catalog without
 * hitting the network; passing null simulates "not loaded yet".
 */
export function setCachedCatalog(data: Pokemon[] | null): void {
  cache = data
}

/**
 * Fetches the catalog from GET /api/pokemons and caches it for the session.
 * Subsequent calls return the cached result. Throws (ApiError) when the
 * request fails; a failed fetch never poisons the cache.
 */
export async function fetchCatalog(): Promise<Pokemon[]> {
  if (cache) return cache
  const data = await fetchCatalogFromApi()
  cache = data
  return data
}

export function typeOptions(catalog: Pokemon[]): string[] {
  return [...new Set(catalog.map((pokemon) => pokemon.type))].sort()
}

export function filterCatalog(
  catalog: Pokemon[],
  search: string,
  type: string,
): Pokemon[] {
  const term = search.trim().toLowerCase()
  return catalog.filter((pokemon) => {
    const matchesSearch = term === '' || pokemon.name.toLowerCase().includes(term)
    const matchesType = type === ALL_TYPES || pokemon.type === type
    return matchesSearch && matchesType
  })
}

/**
 * Resolves a catalog entry by its numeric backend id. Returns undefined when
 * the catalog has not been loaded or the id is unknown (the duel mock then
 * keeps its stub shape for that slot).
 */
export function pokemonById(
  catalog: Pokemon[] | null,
  id: number,
): Pokemon | undefined {
  return catalog?.find((pokemon) => pokemon.id === id)
}
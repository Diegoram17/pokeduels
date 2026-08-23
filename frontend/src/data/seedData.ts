// Typed access to the seed catalog served from /seed-data.json (copied from the
// repo root into public/). The file is fetched once and cached for the session.

export interface PokemonSeed {
  name: string
  type: string
  pokeapi_id: number
  sprite_url: string
  back_sprite_url: string
  is_starter: boolean
}

export interface SeedData {
  _meta: {
    version: string
    description: string
    total_starters: number
    total_catalog: number
    notes: string[]
  }
  starters: PokemonSeed[]
  catalog: PokemonSeed[]
}

let cache: SeedData | null = null

/**
 * Synchronous access to the loaded catalog — used by the state store to
 * resolve real name/type/sprite data when a duel starts. Null until the first
 * fetchSeedData() resolves (the team-select screen always fetches before a
 * duel can begin, so the cache is warm in the real flow).
 */
export function getCachedSeedData(): SeedData | null {
  return cache
}

/**
 * Replaces the cached catalog. Used by tests to seed a known catalog without
 * hitting the network; passing null simulates "not loaded yet".
 */
export function setCachedSeedData(data: SeedData | null): void {
  cache = data
}

/**
 * Fetches the seed data JSON from the public assets. Subsequent calls return
 * the cached result. Throws if the file cannot be loaded.
 */
export async function fetchSeedData(): Promise<SeedData> {
  if (cache) return cache
  const res = await fetch('/seed-data.json')
  if (!res.ok) {
    throw new Error(`Failed to load seed data: HTTP ${res.status}`)
  }
  cache = (await res.json()) as SeedData
  return cache
}
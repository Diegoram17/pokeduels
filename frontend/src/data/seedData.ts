// Typed access to the seed catalog served from /seed-data.json (copied from the
// repo root into public/). The file is fetched once and cached for the session.

export interface PokemonSeed {
  name: string
  type: string
  pokeapi_id: number
  sprite_url: string
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
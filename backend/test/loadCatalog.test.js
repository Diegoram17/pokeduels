import { describe, it, expect } from 'vitest';
import { mergeCatalog, loadCatalogFromFile, readSeedData, DEFAULT_SEED_DATA_PATH } from '../seed/loadCatalog.js';

const starters = [
  { name: 'Pikachu', type: 'electric', pokeapi_id: 25, is_starter: true },
  { name: 'Bulbasaur', type: 'grass', pokeapi_id: 1, is_starter: true },
];

const catalog = [
  { name: 'Snorlax', type: 'normal', pokeapi_id: 143, is_starter: false },
  { name: 'Gengar', type: 'ghost', pokeapi_id: 94, is_starter: false },
  { name: 'Tyranitar-Dark', type: 'dark', pokeapi_id: 359, is_starter: false },
];

describe('mergeCatalog', () => {
  it('merges starters and catalog into a single ordered list', () => {
    const merged = mergeCatalog({ starters, catalog });
    expect(merged).toHaveLength(5);
    expect(merged[0].name).toBe('Pikachu'); // starters first
    expect(merged[4].name).toBe('Tyranitar-Dark'); // then catalog
  });

  it('rejects a pokemon whose type is outside the canonical 18', () => {
    const bad = [{ name: 'Cosmog', type: 'cosmic', pokeapi_id: 999, is_starter: false }];
    expect(() => mergeCatalog({ starters: [], catalog: bad })).toThrow(/cosmic/);
  });

  it('rejects duplicate pokemon names across the merged list', () => {
    const duplicated = [...catalog, { name: 'Gengar', type: 'poison', pokeapi_id: 94, is_starter: false }];
    expect(() => mergeCatalog({ starters: [], catalog: duplicated })).toThrow(/Gengar/);
  });
});

describe('loadCatalogFromFile', () => {
  it('loads the canonical root seed-data.json: 54 pokemon, exactly 4 starters, no duplicate names', () => {
    const rows = loadCatalogFromFile();
    expect(rows).toHaveLength(54);
    expect(rows.filter((p) => p.is_starter)).toHaveLength(4);
    expect(new Set(rows.map((p) => p.name)).size).toBe(54);
  });

  it('carries a non-empty back_sprite_url for all 54 pokemon', () => {
    const rows = loadCatalogFromFile();
    const withBackSprite = rows.filter(
      (p) => typeof p.back_sprite_url === 'string' && p.back_sprite_url.length > 0,
    );
    expect(withBackSprite).toHaveLength(54);
  });

  it('mirrors the front-sprite convention: every back_sprite_url points at the back/{pokeapi_id} path', () => {
    const rows = loadCatalogFromFile();
    expect(
      rows.every((p) => p.back_sprite_url.endsWith(`/sprites/pokemon/back/${p.pokeapi_id}.png`)),
    ).toBe(true);
  });

  it('exposes a default path pointing at the repo-root seed-data.json', () => {
    expect(DEFAULT_SEED_DATA_PATH.endsWith('seed-data.json')).toBe(true);
  });
});

describe('readSeedData', () => {
  it('parses the canonical root seed-data.json with catalog and sparse effectiveness', () => {
    const data = readSeedData();
    expect(data.starters).toHaveLength(4);
    expect(data.catalog).toHaveLength(50);
    expect(data.type_effectiveness).toHaveLength(120);
  });
});

describe('pokeapi_id uniqueness (regression: Tyranitar-Dark once collided with Weavile at 461)', () => {
  it('has no duplicate pokeapi_id across all 54 starters + catalog entries', () => {
    const rows = loadCatalogFromFile();
    const ids = rows.map((p) => p.pokeapi_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
// tests/fixtures.js
export const samplePokemon = {
  pikachu: { pokemonId: 25, name: 'Pikachu', type: 'electric' },
  charizard: { pokemonId: 6, name: 'Charizard', type: 'fire' },
  blastoise: { pokemonId: 9, name: 'Blastoise', type: 'water' },
  venusaur: { pokemonId: 3, name: 'Venusaur', type: 'grass' },
  gengar: { pokemonId: 94, name: 'Gengar', type: 'ghost' },
  dragonite: { pokemonId: 149, name: 'Dragonite', type: 'dragon' },
};

export const sampleTypeChart = [
  { attacking_type: 'fire', defending_type: 'grass', multiplier: 2.0 },
  { attacking_type: 'fire', defending_type: 'fire', multiplier: 0.5 },
  { attacking_type: 'fire', defending_type: 'water', multiplier: 0.5 },
  { attacking_type: 'water', defending_type: 'fire', multiplier: 2.0 },
  { attacking_type: 'water', defending_type: 'water', multiplier: 0.5 },
  { attacking_type: 'water', defending_type: 'grass', multiplier: 0.5 },
  { attacking_type: 'grass', defending_type: 'water', multiplier: 2.0 },
  { attacking_type: 'grass', defending_type: 'fire', multiplier: 0.5 },
  { attacking_type: 'grass', defending_type: 'grass', multiplier: 0.5 },
  { attacking_type: 'electric', defending_type: 'water', multiplier: 2.0 },
  { attacking_type: 'electric', defending_type: 'grass', multiplier: 0.5 },
  { attacking_type: 'ghost', defending_type: 'ghost', multiplier: 2.0 },
  { attacking_type: 'ghost', defending_type: 'normal', multiplier: 0.5 },
];

export function createFullTeam(prefix = 'p1') {
  return [
    { ...samplePokemon.pikachu },
    { ...samplePokemon.charizard },
    { ...samplePokemon.blastoise },
    { ...samplePokemon.venusaur },
    { ...samplePokemon.gengar },
    { ...samplePokemon.dragonite },
  ].map((p, i) => ({
    ...p,
    pokemonId: p.pokemonId + (prefix === 'p1' ? 0 : 100),
  }));
}
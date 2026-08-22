-- 0001_initial-schema (down)
-- Reverts the full schema in reverse foreign-key order.
DROP TABLE IF EXISTS moves;
DROP TABLE IF EXISTS duel_pokemon_state;
DROP TABLE IF EXISTS duels;
DROP TABLE IF EXISTS team_selections;
DROP TABLE IF EXISTS room_players;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS pokemons;
DROP TABLE IF EXISTS type_effectiveness;
DROP TABLE IF EXISTS types;
DROP TABLE IF EXISTS players;
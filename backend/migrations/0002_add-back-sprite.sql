-- Up Migration
ALTER TABLE pokemons ADD COLUMN back_sprite_url TEXT;

-- Down Migration
ALTER TABLE pokemons DROP COLUMN back_sprite_url;
-- Up Migration
-- 0004: Bot support for single-player testing
-- Adds is_bot flag to players table so bots can be distinguished from human players.
-- Bots are controlled by the server and make random decisions.

ALTER TABLE players ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for efficient bot queries (optional but useful for analytics)
CREATE INDEX IF NOT EXISTS idx_players_is_bot ON players(is_bot);

-- Down Migration
DROP INDEX IF EXISTS idx_players_is_bot;
ALTER TABLE players DROP COLUMN IF EXISTS is_bot;

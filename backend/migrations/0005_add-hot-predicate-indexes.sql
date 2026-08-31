-- Up Migration
-- 0005: hot-predicate indexes for the most frequent query paths.
--   * duel_pokemon_state/moves by duel_id  -> per-duel state reads
--   * duels by room_id / player1_id / player2_id -> roster + findActiveDuelForPlayer
--     (two single-column btrees serve the OR-across-columns predicate via
--      BitmapOr; a composite index cannot)
--   * partial duels(status) WHERE status IN ('pending','in_progress') -> stays tiny
--     as most rows become 'finished'; serves boot reconcile + idempotency checks
--   * partial rooms(status) WHERE status = 'waiting' -> lobby listing
-- Plain CREATE INDEX (not CONCURRENTLY): node-pg-migrate wraps each migration
-- in a transaction, and the tables are tiny in v1 (sub-second SHARE lock).

CREATE INDEX IF NOT EXISTS idx_duel_pokemon_state_duel_id ON duel_pokemon_state (duel_id);
CREATE INDEX IF NOT EXISTS idx_moves_duel_id              ON moves (duel_id);
CREATE INDEX IF NOT EXISTS idx_duels_room_id              ON duels (room_id);
CREATE INDEX IF NOT EXISTS idx_duels_player1_id           ON duels (player1_id);
CREATE INDEX IF NOT EXISTS idx_duels_player2_id           ON duels (player2_id);
CREATE INDEX IF NOT EXISTS idx_duels_active ON duels (status)
  WHERE status IN ('pending','in_progress');
CREATE INDEX IF NOT EXISTS idx_rooms_waiting ON rooms (status)
  WHERE status = 'waiting';

-- Down Migration
DROP INDEX IF EXISTS idx_rooms_waiting;
DROP INDEX IF EXISTS idx_duels_active;
DROP INDEX IF EXISTS idx_duels_player2_id;
DROP INDEX IF EXISTS idx_duels_player1_id;
DROP INDEX IF EXISTS idx_duels_room_id;
DROP INDEX IF EXISTS idx_moves_duel_id;
DROP INDEX IF EXISTS idx_duel_pokemon_state_duel_id;
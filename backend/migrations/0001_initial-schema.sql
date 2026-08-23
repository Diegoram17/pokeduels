-- Up Migration
-- 0001_initial-schema (up)
-- Schema per TECH-DESIGN 3.1 (ADR-0002 / ADR-0007): 10 tables.
-- Closes the 4 resolved CHECK gaps from the db-schema-seed design:
--   duel_pokemon_state: current_hp 0-100 (permanent ceiling), pp_move_1/2/3 0-4
--   rooms.status, duels.round/status/end_reason, moves.action_type/effectiveness/move_index enum CHECKs

-- Ephemeral player identities by nickname; no persistent accounts.
-- Nickname is NOT globally unique: uniqueness is enforced per-room (room_players).
CREATE TABLE players (
  id            SERIAL PRIMARY KEY,
  nickname      VARCHAR(30) NOT NULL,
  session_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Canonical 18-type catalog; prevents typos across pokemons / type_effectiveness.
CREATE TABLE types (
  name VARCHAR(20) PRIMARY KEY
);

-- Static catalog (seed: 4 starters + 50 catalog entries).
CREATE TABLE pokemons (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) UNIQUE NOT NULL,
  type        VARCHAR(20) NOT NULL REFERENCES types(name), -- single type per entry
  pokeapi_id  INTEGER NOT NULL,                            -- sprite URL builder
  sprite_url  TEXT,                                        -- cached at seed time
  is_starter  BOOLEAN DEFAULT FALSE
);

-- Full 18x18 effectiveness matrix (see ADR-0007).
CREATE TABLE type_effectiveness (
  attacking_type VARCHAR(20) NOT NULL REFERENCES types(name),
  defending_type VARCHAR(20) NOT NULL REFERENCES types(name),
  multiplier     NUMERIC(2,1) NOT NULL CHECK (multiplier IN (2.0, 1.0, 0.5)),
  PRIMARY KEY (attacking_type, defending_type)
);

CREATE TABLE rooms (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(8) UNIQUE NOT NULL, -- short join code
  max_players SMALLINT NOT NULL CHECK (max_players IN (2,4)),
  status      VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting','in_progress','finished','aborted')),
  created_by  INTEGER REFERENCES players(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE room_players (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  player_id  INTEGER REFERENCES players(id),
  nickname   VARCHAR(30) NOT NULL, -- copy enforcing per-room nickname uniqueness
  ready      BOOLEAN DEFAULT FALSE,
  connected  BOOLEAN DEFAULT TRUE,
  final_rank SMALLINT,             -- 1..4, filled when the room finishes
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (room_id, player_id),
  UNIQUE (room_id, nickname)       -- no duplicate nicknames within a room
);

CREATE TABLE team_selections (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  player_id  INTEGER REFERENCES players(id),
  pokemon_id INTEGER REFERENCES pokemons(id),
  is_starter BOOLEAN DEFAULT FALSE,
  slot       SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 6),
  UNIQUE (room_id, player_id, slot),
  UNIQUE (room_id, player_id, pokemon_id) -- no repeated pokemon within one team
);

-- Starter exclusivity per room (RF-3.2): one starter cannot repeat between
-- players of the same room.
CREATE UNIQUE INDEX uq_starter_por_sala
  ON team_selections (room_id, pokemon_id)
  WHERE is_starter = TRUE;

CREATE TABLE duels (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  player1_id INTEGER REFERENCES players(id),
  player2_id INTEGER REFERENCES players(id),
  round      VARCHAR(20) NOT NULL CHECK (round IN ('unica','semifinal','final','tercer_puesto')),
  winner_id  INTEGER REFERENCES players(id),
  status     VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','finished')),
  end_reason VARCHAR(20) CHECK (end_reason IN ('ko','disconnect','surrender','server_restart')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Live state of each pokemon during a duel; starts at full HP/PP every duel.
CREATE TABLE duel_pokemon_state (
  id         SERIAL PRIMARY KEY,
  duel_id    INTEGER REFERENCES duels(id) ON DELETE CASCADE,
  player_id  INTEGER REFERENCES players(id),
  pokemon_id INTEGER REFERENCES pokemons(id),
  current_hp SMALLINT NOT NULL DEFAULT 100 CHECK (current_hp BETWEEN 0 AND 100),
  pp_move_1  SMALLINT NOT NULL DEFAULT 4 CHECK (pp_move_1 BETWEEN 0 AND 4), -- 25 dmg
  pp_move_2  SMALLINT NOT NULL DEFAULT 4 CHECK (pp_move_2 BETWEEN 0 AND 4), -- 20 dmg
  pp_move_3  SMALLINT NOT NULL DEFAULT 4 CHECK (pp_move_3 BETWEEN 0 AND 4), -- 15 dmg
  -- move_4 (10 dmg) carries no PP: unlimited
  is_active  BOOLEAN DEFAULT FALSE, -- on the field
  fainted    BOOLEAN DEFAULT FALSE,
  UNIQUE (duel_id, player_id, pokemon_id)
);

-- Append-only action log (audit + turn replay).
CREATE TABLE moves (
  id                SERIAL PRIMARY KEY,
  duel_id           INTEGER REFERENCES duels(id) ON DELETE CASCADE,
  turn_number       INTEGER NOT NULL,
  player_id         INTEGER REFERENCES players(id),
  action_type       VARCHAR(10) NOT NULL CHECK (action_type IN ('attack','switch')),
  pokemon_id        INTEGER REFERENCES pokemons(id),
  move_index        SMALLINT CHECK (move_index BETWEEN 1 AND 4), -- 1..4 when action_type='attack'
  target_pokemon_id INTEGER REFERENCES pokemons(id),
  damage_dealt      SMALLINT,
  effectiveness     NUMERIC(2,1) CHECK (effectiveness IN (2.0, 1.0, 0.5)),
  was_timeout       BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  -- Business rule (user-confirmed): an attack must always carry its move_index.
  CONSTRAINT chk_move_index_required_for_attack
    CHECK (action_type <> 'attack' OR move_index IS NOT NULL)
);

-- Down Migration
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
import { pool } from '../db/pool.js';
import { selectStarter, selectRoster } from '../db/teamSelections.js';
import { getPlayerRoster, activateLead } from '../repositories/duelRepository.js';

/**
 * Bot manager: handles creation, removal, and AI decisions for bot players.
 * Bots are real players in the DB with is_bot=TRUE, controlled by the server.
 * They make random decisions for team selection and duel actions.
 */

const BOT_NAMES = ['Ash', 'Misty', 'Brock', 'Gary', 'Dawn', 'May', 'Iris', 'Clemont', 'Serena', 'Lillie'];

/**
 * Creates a bot player in a room. The bot is a real player row with is_bot=TRUE.
 * Returns the bot's player id and the updated room state.
 */
export async function createBot(roomId, creatorPlayerId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get room info
    const { rows: roomRows } = await client.query(
      'SELECT id, max_players, status FROM rooms WHERE id = $1 FOR UPDATE',
      [roomId]
    );
    const room = roomRows[0];
    if (!room) throw new Error('Room not found');
    if (room.status !== 'waiting') throw new Error('Room is not waiting');

    // Count current players
    const { rows: countRows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
      [roomId]
    );
    if (countRows[0].n >= room.max_players) {
      throw new Error('Room is full');
    }

    // Verify creator is in the room
    const { rows: creatorRows } = await client.query(
      'SELECT id FROM room_players WHERE room_id = $1 AND player_id = $2',
      [roomId, creatorPlayerId]
    );
    if (!creatorRows[0]) throw new Error('Only room members can create bots');

    // Create bot player
    const botName = '🤖 ' + BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + 
                    Math.floor(Math.random() * 1000);
    const { rows: botRows } = await client.query(
      `INSERT INTO players (nickname, is_bot) VALUES ($1, TRUE) 
       RETURNING id, nickname`,
      [botName]
    );
    const bot = botRows[0];

    // Add bot to room
    await client.query(
      `INSERT INTO room_players (room_id, player_id, nickname, connected, ready) 
       VALUES ($1, $2, $3, TRUE, FALSE)`,
      [roomId, bot.id, bot.nickname]
    );

    await client.query('COMMIT');

    // Auto-select team for bot (random starter + random roster)
    await autoSelectBotTeam(roomId, bot.id);

    return { id: bot.id, nickname: bot.nickname };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes a bot from a room. Only the room creator or the bot itself can be removed.
 */
export async function removeBot(roomId, botId, requesterPlayerId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify bot exists and is a bot
    const { rows: botRows } = await client.query(
      'SELECT id FROM players WHERE id = $1 AND is_bot = TRUE',
      [botId]
    );
    if (!botRows[0]) throw new Error('Bot not found');

    // Verify requester is in the room
    const { rows: requesterRows } = await client.query(
      'SELECT id FROM room_players WHERE room_id = $1 AND player_id = $2',
      [roomId, requesterPlayerId]
    );
    if (!requesterRows[0]) throw new Error('Only room members can remove bots');

    // Remove bot from room
    await client.query(
      'DELETE FROM room_players WHERE room_id = $1 AND player_id = $2',
      [roomId, botId]
    );

    // Remove bot's team selections
    await client.query(
      'DELETE FROM team_selections WHERE room_id = $1 AND player_id = $2',
      [roomId, botId]
    );

    // Check if room is now empty
    const { rows: countRows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM room_players WHERE room_id = $1',
      [roomId]
    );
    
    let roomDeleted = false;
    if (countRows[0].n === 0) {
      await client.query('DELETE FROM rooms WHERE id = $1 AND status = \'waiting\'', [roomId]);
      roomDeleted = true;
    }

    await client.query('COMMIT');
    return { removed: true, roomDeleted };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Automatically selects a random team for a bot: 1 starter + 5 roster pokemon.
 */
async function autoSelectBotTeam(roomId, botId) {
  // Get available pokemon (not already taken as starters in this room)
  const { rows: takenStarters } = await pool.query(
    'SELECT pokemon_id FROM team_selections WHERE room_id = $1 AND is_starter = TRUE',
    [roomId]
  );
  const takenStarterIds = new Set(takenStarters.map(r => r.pokemon_id));

  // Get all starter-eligible pokemon
  const { rows: allStarters } = await pool.query(
    'SELECT id FROM pokemons WHERE is_starter = TRUE'
  );
  const availableStarters = allStarters.filter(p => !takenStarterIds.has(p.id));
  
  if (availableStarters.length === 0) return; // No starters available

  // Pick random starter
  const starter = availableStarters[Math.floor(Math.random() * availableStarters.length)];
  await selectStarter(roomId, botId, starter.id);

  // Get all pokemon for roster (excluding the starter we just picked)
  const { rows: allPokemon } = await pool.query(
    'SELECT id FROM pokemons WHERE id != $1',
    [starter.id]
  );

  // Pick 5 random pokemon for roster
  const shuffled = allPokemon.sort(() => 0.5 - Math.random());
  const roster = shuffled.slice(0, 5).map(p => p.id);

  if (roster.length === 5) {
    await selectRoster(roomId, botId, roster);
  }

  // Mark bot as ready
  await pool.query(
    'UPDATE room_players SET ready = TRUE WHERE room_id = $1 AND player_id = $2',
    [roomId, botId]
  );
}

/**
 * True when the player id belongs to a server-controlled bot. Bots have no
 * socket, so every bot decision (lead, attack, switch) must be made here —
 * the client-side useBotAutomation cannot impersonate them (the WS layer
 * resolves identity from the emitting socket).
 */
export async function isBotPlayer(playerId) {
  const { rows } = await pool.query('SELECT is_bot FROM players WHERE id = $1', [playerId]);
  return rows[0]?.is_bot === true;
}

/**
 * The other participant of a duel, from the canonical duel row
 * ({ player1_id, player2_id }).
 */
export function opponentOf(duel, playerId) {
  return playerId === duel.player1_id ? duel.player2_id : duel.player1_id;
}

/**
 * Server-side first-lead selection for a bot: activates a random healthy
 * roster pokemon as its lead. Returns the picked pokemon id, or null when the
 * bot already has an active pokemon or nothing is selectable.
 */
export async function selectBotLead(duelId, botId) {
  const roster = await getPlayerRoster(duelId, botId);
  if (roster.some((p) => p.is_active)) return null;
  const candidates = roster.filter((p) => !p.fainted && !p.is_active);
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  await activateLead(duelId, botId, pick.pokemon_id);
  return pick.pokemon_id;
}

/**
 * Makes a random duel action for a bot (server-side). The duel state rows are
 * the canonical snake_case shapes from getDuelState().pokemonStates.
 * Returns the action to take: { type: 'move', moveIndex: 1-4 } or
 * { type: 'switch', pokemonId } or null when the bot cannot act at all.
 */
export async function makeBotDuelAction(duelId, botPlayerId, pokemonStates) {
  const botPokemon = pokemonStates.filter((p) => p.player_id === botPlayerId);
  const activePokemon = botPokemon.find((p) => p.is_active && !p.fainted);

  if (!activePokemon) {
    // No active pokemon, must switch in a bench unit.
    const availableSwitch = botPokemon.find((p) => !p.fainted && !p.is_active);
    if (availableSwitch) {
      return { type: 'switch', pokemonId: availableSwitch.pokemon_id };
    }
    return null;
  }

  // Moves 1-3 consume PP; move 4 (basic attack) is always available.
  const movesWithPP = [1, 2, 3].filter((moveIndex) => activePokemon[`pp_move_${moveIndex}`] > 0);

  if (movesWithPP.length === 0) {
    const availableSwitch = botPokemon.find((p) => !p.fainted && !p.is_active);
    if (availableSwitch) {
      return { type: 'switch', pokemonId: availableSwitch.pokemon_id };
    }
    return { type: 'move', moveIndex: 4 };
  }

  const randomMoveIndex = movesWithPP[Math.floor(Math.random() * movesWithPP.length)];
  return { type: 'move', moveIndex: randomMoveIndex };
}

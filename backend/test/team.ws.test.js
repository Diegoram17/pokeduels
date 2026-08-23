import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { createRoomWithCreator } from '../db/rooms.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';
import { startWsHarness, waitForEvent, waitUntil, joinRoomViaWs } from './wsHelpers.js';

/**
 * Starter/roster selection over a real Socket.IO connection (spec: Starter
 * Selection with Exclusivity, Roster Selection Without Exclusivity). Starter
 * races resolve against the uq_starter_por_sala partial unique index; roster
 * picks are only constrained per player, so two players may share a
 * non-starter pokemon.
 */
describe.skipIf(!hasDatabase)('team selection over WS (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
    await pool.query('SELECT 1'); // warm the Neon cold start
  }, SEED_TIMEOUT);

  const roomIds = [];
  const harnesses = [];

  async function startHarness() {
    const harness = await startWsHarness();
    harnesses.push(harness);
    return harness;
  }

  afterEach(async () => {
    while (harnesses.length) await harnesses.pop().teardown();
  });

  afterAll(async () => {
    if (roomIds.length) {
      await pool.query('DELETE FROM rooms WHERE id = ANY($1::int[])', [roomIds]);
    }
    await pool.end();
  });

  async function firstPokemonIds(n) {
    const { rows } = await pool.query('SELECT id FROM pokemons ORDER BY id LIMIT $1', [n]);
    return rows.map((r) => r.id);
  }

  /** Seats two players (creator + joiner) in a fresh room and returns both clients. */
  async function seatTwo() {
    const harness = await startHarness();
    const creator = await createPlayer('WsTeamCreator');
    const joiner = await createPlayer('WsTeamJoiner');
    const room = await createRoomWithCreator(4, creator.id);
    roomIds.push(room.id);
    const { client: creatorClient } = await joinRoomViaWs(harness, creator, room.code);
    // The joiner's join broadcast reaches BOTH sockets; consume the creator's
    // copy here so later waitForEvent calls never catch this stale event.
    const staleP = waitForEvent(creatorClient, 'room:state');
    const { client: joinerClient } = await joinRoomViaWs(harness, joiner, room.code);
    await staleP;
    return { harness, creator, joiner, room, creatorClient, joinerClient };
  }

  it('broadcasts room:state with the reservation after a successful starter selection', async () => {
    const { creator, room, creatorClient } = await seatTwo();
    const [pokeId] = await firstPokemonIds(1);

    const stateP = waitForEvent(creatorClient, 'room:state');
    creatorClient.emit('team:select_starter', { pokemonId: pokeId });
    const state = await stateP;

    expect(state.startersTaken).toEqual([pokeId]);

    const { rows } = await pool.query(
      'SELECT is_starter, slot FROM team_selections WHERE room_id = $1 AND player_id = $2',
      [room.id, creator.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_starter).toBe(true);
    expect(rows[0].slot).toBe(1);
  });

  it('rejects exactly one of two concurrent starter picks and keeps the winner reservation', async () => {
    const { creator, joiner, room, creatorClient, joinerClient } = await seatTwo();
    const [pokeId] = await firstPokemonIds(1);

    // Fire both picks without awaiting; whichever insert wins the
    // uq_starter_por_sala race, the other must get team:starter_rejected and
    // the room:state (from the winner's handler) must show one reservation.
    const rejectedP = Promise.race([
      waitForEvent(creatorClient, 'team:starter_rejected').then((payload) => ({ who: 'creator', payload })),
      waitForEvent(joinerClient, 'team:starter_rejected').then((payload) => ({ who: 'joiner', payload })),
    ]);
    const stateP = waitForEvent(creatorClient, 'room:state');
    creatorClient.emit('team:select_starter', { pokemonId: pokeId });
    joinerClient.emit('team:select_starter', { pokemonId: pokeId });

    const { who, payload } = await rejectedP;
    const state = await stateP;

    expect(payload).toMatchObject({ pokemonId: pokeId, reason: 'taken' });
    expect(state.startersTaken).toEqual([pokeId]);

    const winnerId = who === 'creator' ? joiner.id : creator.id;
    const { rows: winners } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM team_selections WHERE room_id = $1 AND player_id = $2',
      [room.id, winnerId],
    );
    expect(winners[0].n).toBe(1);
    const { rows: total } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM team_selections WHERE room_id = $1 AND is_starter = TRUE',
      [room.id],
    );
    expect(total[0].n).toBe(1);
  });

  it('allows two players to select the same non-starter pokemon', async () => {
    const { creator, joiner, room, creatorClient, joinerClient } = await seatTwo();
    const pokemonIds = await firstPokemonIds(5);

    // Broadcasts are indistinguishable between the two players (each
    // select_roster success broadcasts an identical room:state), and on a slow
    // DB the two handlers commit out of order — so the identity of any given
    // room:state event is racy. The deterministic contract is the DB: both
    // rosters must persist, and no team:roster_rejected may be emitted.
    const rejections = [];
    creatorClient.on('team:roster_rejected', (payload) => rejections.push(payload));
    joinerClient.on('team:roster_rejected', (payload) => rejections.push(payload));

    creatorClient.emit('team:select_roster', { pokemonIds });
    joinerClient.emit('team:select_roster', { pokemonIds });

    await waitUntil(
      async () => {
        for (const player of [creator, joiner]) {
          const { rows } = await pool.query(
            'SELECT COUNT(*)::int AS n FROM team_selections WHERE room_id = $1 AND player_id = $2',
            [room.id, player.id],
          );
          if (rows[0].n !== 5) return false;
        }
        return true;
      },
      15000,
    );

    // Roster rows carry no cross-player uniqueness, so the duplicate picks
    // must NOT surface a rejection.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(rejections).toEqual([]);
  });

  it('rejects an invalid roster count and leaves the roster unchanged', async () => {
    const { creator, room, creatorClient } = await seatTwo();
    const ids = await firstPokemonIds(6);

    const tooFewP = waitForEvent(creatorClient, 'team:roster_rejected');
    creatorClient.emit('team:select_roster', { pokemonIds: ids.slice(0, 4) });
    const tooFew = await tooFewP;
    expect(tooFew).toEqual({ reason: 'invalid_count' });

    const tooManyP = waitForEvent(creatorClient, 'team:roster_rejected');
    creatorClient.emit('team:select_roster', { pokemonIds: ids });
    const tooMany = await tooManyP;
    expect(tooMany).toEqual({ reason: 'invalid_count' });

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM team_selections WHERE room_id = $1 AND player_id = $2',
      [room.id, creator.id],
    );
    expect(rows[0].n).toBe(0);
  });
});
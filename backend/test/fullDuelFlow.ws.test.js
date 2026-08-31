import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { pool } from '../db/pool.js';
import { createPlayer } from '../db/players.js';
import { createRoomWithCreator } from '../db/rooms.js';
import { selectStarter, selectRoster } from '../db/teamSelections.js';
import { hasDatabase, ensureSchemaAndSeed, SEED_TIMEOUT } from './helpers.js';
import {
  startWsHarness,
  waitForEvent,
  joinRoomViaWs,
  readyAll,
  joinDuelChannel,
  selectLeads,
  playDuelToKO,
} from './wsHelpers.js';

/**
 * End-to-end 4-player bracket entirely over real Socket.IO connections (spec
 * A5): 4 clients join one room -> DB-seed 4 rosters -> room:ready x4 -> the
 * bracket bootstrap pairs 2 random semifinals (tournament:bracket +
 * duel:start x2) -> each semifinal played to duel:finished -> the finals +
 * third-place duels are created (tournament:bracket + duel:start x2) -> played
 * -> room:final_ranking with finalRank 1-4.
 *
 * The first assertion is the A5 latent-bug gate (design Q8, user decision
 * 2026-08-29): each semifinal's first `duel:state` must carry EXACTLY the
 * pair's 12 `pokemonStates` (2 players x 6 pokemon). Before the seed-scope fix
 * (`createDuelFromRoom` + `AND player_id IN ($3,$4)`), every semifinal is
 * seeded from ALL 4 rosters sharing the room -> 24 rows -> this assertion
 * fails RED. The whole flow still completes on the unfixed code (all
 * per-player logic filters by player_id), so the 12-row assertion is the ONLY
 * thing that fails — a clean RED -> GREEN gate.
 */
describe.skipIf(!hasDatabase)('full 4-player bracket over WS (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    await ensureSchemaAndSeed(pool);
    await pool.query('SELECT 1'); // warm the Neon cold start
  }, SEED_TIMEOUT);

  const roomIds = [];
  const harnesses = [];

  async function startHarness(options) {
    const harness = await startWsHarness({ turnTimeoutMs: 60000, ...options });
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

  it('runs the full bracket to room:final_ranking with exactly 12 seeded pokemonStates per semifinal', async () => {
    const harness = await startHarness();

    // 4 players + a 4-seat room; seat every one over WS. Each new join
    // broadcasts a room:state to all previously-seated clients — drain those
    // stale copies so readyAll's drains never catch one.
    const players = [];
    for (let i = 0; i < 4; i += 1) players.push(await createPlayer(`FlowP${i}`));
    const room = await createRoomWithCreator(4, players[0].id);
    roomIds.push(room.id);

    const clients = [];
    // Seat every player over WS. Each join broadcasts a room:state to every
    // already-seated client — those stale copies arrive WHILE the join handler
    // runs (socket.io-client does not buffer events), so each one is
    // pre-registered BEFORE the join emit, exactly like the 1v1 suite's
    // `stale` drain. The joining client's own copy is consumed by
    // joinRoomViaWs.
    for (let i = 0; i < 4; i += 1) {
      const stales = [];
      for (let j = 0; j < i; j += 1) {
        stales.push(waitForEvent(clients[j], 'room:state')); // stale joiner-join broadcast
      }
      const { client } = await joinRoomViaWs(harness, players[i], room.code);
      clients.push(client);
      await Promise.all(stales);
    }

    // DB-seed 4 full rosters (starter + 5 bench) from pokemons 1..24.
    const pokes = (
      await pool.query('SELECT id FROM pokemons ORDER BY id LIMIT 24')
    ).rows.map((r) => r.id);
    const teams = [0, 6, 12, 18].map((offset) => pokes.slice(offset, offset + 6));
    for (let i = 0; i < 4; i += 1) {
      await selectStarter(room.id, players[i].id, teams[i][0]);
      await selectRoster(room.id, players[i].id, teams[i].slice(1));
    }

    const clientFor = (playerId) => clients[players.findIndex((p) => p.id === playerId)];
    const teamFor = (playerId) => teams[players.findIndex((p) => p.id === playerId)];

    // All 4 ready -> the bracket bootstrap: tournament:bracket + 2x duel:start.
    const bracketP = waitForEvent(clients[0], 'tournament:bracket', 45000);
    const starts = await readyAll(clients, { expectedStarts: 2 });
    const bracket = await bracketP;
    expect(starts).toHaveLength(2);
    expect(bracket.roomId).toBe(room.id);
    expect(bracket.bracket.semiA).toBeTruthy();
    expect(bracket.bracket.semiB).toBeTruthy();

    const semis = [bracket.bracket.semiA, bracket.bracket.semiB];

    // Play both semifinals to KO: the SECOND player of each pair is stacked at
    // the brink (its own team), so the FIRST player wins deterministically.
    const finalsBracketP = waitForEvent(clients[0], 'tournament:bracket', 45000);
    for (const semi of semis) {
      const [cA, cB] = [clientFor(semi.playerA), clientFor(semi.playerB)];

      // THE A5 latent-bug gate: each semifinal's first duel:state carries
      // exactly the pair's 12 pokemonStates — never all 4 rosters (24).
      // Triangulated in the DB with the same count.
      const sA = await joinDuelChannel(cA, semi.duelId);
      const sB = await joinDuelChannel(cB, semi.duelId);
      expect(sA.duelId).toBe(semi.duelId);
      expect(sA.pokemonStates).toHaveLength(12);
      expect(sB.pokemonStates).toHaveLength(12);
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM duel_pokemon_state WHERE duel_id = $1',
        [semi.duelId],
      );
      expect(rows[0].n).toBe(12);

      await selectLeads(
        [cA, cB],
        semi.duelId,
        [teamFor(semi.playerA)[0], teamFor(semi.playerB)[0]],
        harness.ctx.phaseStore,
      );
      const finished = await playDuelToKO([cA, cB], semi.duelId, {
        hpStack: { playerId: semi.playerB, leadPokemonId: teamFor(semi.playerB)[0] },
      });
      expect(finished).toMatchObject({
        duelId: semi.duelId,
        winnerId: semi.playerA,
        endReason: 'ko',
      });
    }

    // Both semifinals done -> the lifecycle creates final + tercer_puesto and
    // broadcasts a second tournament:bracket (registered before the last semi
    // finished so no event is missed).
    const finalsBracket = await finalsBracketP;
    const final = finalsBracket.bracket.final;
    const third = finalsBracket.bracket.thirdPlace;
    expect(final).toBeTruthy();
    expect(third).toBeTruthy();

    // Play the final and third-place duels the same way (playerB of each
    // stacked at the brink -> playerA wins). The third-place finish closes the
    // bracket and emits room:final_ranking.
    const rankingP = waitForEvent(clients[0], 'room:final_ranking', 45000);
    for (const pair of [final, third]) {
      const [cA, cB] = [clientFor(pair.playerA), clientFor(pair.playerB)];
      await joinDuelChannel(cA, pair.duelId);
      await joinDuelChannel(cB, pair.duelId);
      await selectLeads(
        [cA, cB],
        pair.duelId,
        [teamFor(pair.playerA)[0], teamFor(pair.playerB)[0]],
        harness.ctx.phaseStore,
      );
      const finished = await playDuelToKO([cA, cB], pair.duelId, {
        hpStack: { playerId: pair.playerB, leadPokemonId: teamFor(pair.playerB)[0] },
      });
      expect(finished).toMatchObject({
        duelId: pair.duelId,
        winnerId: pair.playerA,
        endReason: 'ko',
      });
    }

    const ranking = await rankingP;
    expect(ranking.roomId).toBe(room.id);
    expect(ranking.ranking).toHaveLength(4);
    expect(ranking.ranking.map((r) => r.finalRank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(ranking.ranking.find((r) => r.finalRank === 1).playerId).toBe(final.playerA);
    expect(ranking.ranking.find((r) => r.finalRank === 2).playerId).toBe(final.playerB);
    expect(ranking.ranking.find((r) => r.finalRank === 3).playerId).toBe(third.playerA);
    expect(ranking.ranking.find((r) => r.finalRank === 4).playerId).toBe(third.playerB);
  }, 120000);
});
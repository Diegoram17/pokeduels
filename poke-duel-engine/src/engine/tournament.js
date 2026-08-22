// src/engine/tournament.js
import { createDuel, submitLead, submitSwitch, submitAction, resolveTurn } from './duel.js';
import { MAX_TEAM_SIZE, HP_BASE, INITIAL_PP } from './constants.js';

/**
 * @param {Object} params
 * @param {string} params.tournamentId
 * @param {Array<{id: string, team: Array<{pokemonId: number, name: string, type: string}>}>} params.players
 * @param {RngFn} params.rng
 * @returns {TournamentState}
 */
export function createTournament({ tournamentId, players, rng }) {
  if (players.length !== 2 && players.length !== 4) {
    throw new Error('Tournament must have exactly 2 or 4 players');
  }

  const playerIds = players.map((p) => p.id);
  const duelIds = [];
  const duels = {};
  const rounds = [];

  if (players.length === 2) {
    // Single duel
    const duelId = `${tournamentId}-duel-1`;
    duelIds.push(duelId);
    duels[duelId] = createDuel({
      duelId,
      player1Id: players[0].id,
      player1Team: players[0].team,
      player2Id: players[1].id,
      player2Team: players[1].team,
    });
    rounds.push({
      round: 'unica',
      duels: [duelId],
    });
  } else {
    // 4 players
    // Shuffle players
    const shuffled = [...players];
    // Fisher-Yates shuffle with RNG
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Create semifinals
    const semifinalIds = [];
    for (let i = 0; i < 2; i++) {
      const duelId = `${tournamentId}-semifinal-${i + 1}`;
      semifinalIds.push(duelId);
      duels[duelId] = createDuel({
        duelId,
        player1Id: shuffled[i * 2].id,
        player1Team: shuffled[i * 2].team,
        player2Id: shuffled[i * 2 + 1].id,
        player2Team: shuffled[i * 2 + 1].team,
      });
    }
    rounds.push({
      round: 'semifinal',
      duels: semifinalIds,
    });

    // Round 2 will be generated when semifinals are reported
  }

  return {
    tournamentId,
    size: players.length,
    phase: players.length === 2 ? 'final' : 'semifinal',
    rounds,
    duels,
    results: {},
    eliminated: [],
  };
}

/**
 * @param {TournamentState} tournament
 * @returns {string[]}
 */
export function getPendingDuels(tournament) {
  const pending = [];
  for (const round of tournament.rounds) {
    for (const duelId of round.duels) {
      const duel = tournament.duels[duelId];
      if (duel && duel.phase !== 'FINISHED') {
        pending.push(duelId);
      }
    }
  }
  return pending;
}

/**
 * @param {TournamentState} tournament
 * @param {string} duelId
 * @param {string} winnerId
 * @returns {TournamentState}
 */
export function reportDuelResult(tournament, duelId, winnerId) {
  const newTournament = deepClone(tournament);

  const duel = newTournament.duels[duelId];
  if (!duel) throw new Error('Duel not found');
  if (duel.phase !== 'FINISHED') {
    throw new Error('Duel must be finished to report result');
  }
  if (duel.winnerId !== winnerId) {
    throw new Error(`Winner ${winnerId} does not match duel winner ${duel.winnerId}`);
  }

  // Record result
  const playerIds = Object.keys(duel.players);
  const loserId = playerIds.find((id) => id !== winnerId);
  newTournament.results[duelId] = [winnerId, loserId];
  newTournament.eliminated.push(loserId);

  // Check if we need to generate next round
  const currentRound = newTournament.rounds[newTournament.rounds.length - 1];

  if (newTournament.size === 2) {
    // Tournament is finished
    newTournament.phase = 'finished';
  } else if (currentRound.round === 'semifinal') {
    // Check if both semifinals are reported
    const reportedCount = currentRound.duels.filter((id) => newTournament.results[id]).length;
    if (reportedCount === currentRound.duels.length) {
      // Generate finals
      const winners = [];
      const losers = [];
      for (const id of currentRound.duels) {
        const [win, lose] = newTournament.results[id];
        winners.push(win);
        losers.push(lose);
      }

      const finalDuelId = `${newTournament.tournamentId}-final`;
      const thirdDuelId = `${newTournament.tournamentId}-third`;

      // Create final duel
      const winner1Team = getTeamForPlayer(newTournament, winners[0]);
      const winner2Team = getTeamForPlayer(newTournament, winners[1]);
      newTournament.duels[finalDuelId] = createDuel({
        duelId: finalDuelId,
        player1Id: winners[0],
        player1Team: winner1Team,
        player2Id: winners[1],
        player2Team: winner2Team,
      });

      // Create third place duel
      const loser1Team = getTeamForPlayer(newTournament, losers[0]);
      const loser2Team = getTeamForPlayer(newTournament, losers[1]);
      newTournament.duels[thirdDuelId] = createDuel({
        duelId: thirdDuelId,
        player1Id: losers[0],
        player1Team: loser1Team,
        player2Id: losers[1],
        player2Team: loser2Team,
      });

      newTournament.rounds.push({
        round: 'final',
        duels: [finalDuelId],
      });
      newTournament.rounds.push({
        round: 'tercer_puesto',
        duels: [thirdDuelId],
      });
      newTournament.phase = 'final';
    }
  } else if (currentRound.round === 'final' || currentRound.round === 'tercer_puesto') {
    // Check if both final and third place are done
    const finalRound = newTournament.rounds.find((r) => r.round === 'final');
    const thirdRound = newTournament.rounds.find((r) => r.round === 'tercer_puesto');
    if (finalRound && thirdRound) {
      const finalDone = finalRound.duels.every((id) => newTournament.results[id]);
      const thirdDone = thirdRound.duels.every((id) => newTournament.results[id]);
      if (finalDone && thirdDone) {
        newTournament.phase = 'finished';
      }
    }
  }

  return newTournament;
}

/**
 * @param {TournamentState} tournament
 * @returns {Array<{playerId: string, rank: number}>}
 */
export function getFinalRanking(tournament) {
  if (tournament.phase !== 'finished') {
    throw new Error('Tournament is not finished yet');
  }

  const rankings = [];

  if (tournament.size === 2) {
    // Single duel
    const duelId = tournament.rounds[0].duels[0];
    const duel = tournament.duels[duelId];
    const winner = duel.winnerId;
    const loser = Object.keys(duel.players).find((id) => id !== winner);
    rankings.push({ playerId: winner, rank: 1 });
    rankings.push({ playerId: loser, rank: 2 });
  } else {
    // 4 players
    const finalDuel = tournament.duels[tournament.rounds.find((r) => r.round === 'final').duels[0]];
    const thirdDuel = tournament.duels[tournament.rounds.find((r) => r.round === 'tercer_puesto').duels[0]];

    // 1st and 2nd from final
    const winner1 = finalDuel.winnerId;
    const loser1 = Object.keys(finalDuel.players).find((id) => id !== winner1);
    rankings.push({ playerId: winner1, rank: 1 });
    rankings.push({ playerId: loser1, rank: 2 });

    // 3rd and 4th from third place
    const winner3 = thirdDuel.winnerId;
    const loser3 = Object.keys(thirdDuel.players).find((id) => id !== winner3);
    rankings.push({ playerId: winner3, rank: 3 });
    rankings.push({ playerId: loser3, rank: 4 });
  }

  return rankings;
}

/**
 * @param {TournamentState} tournament
 * @returns {boolean}
 */
export function isTournamentFinished(tournament) {
  return tournament.phase === 'finished';
}

/**
 * Get team for a player from tournament state
 * @param {TournamentState} tournament
 * @param {string} playerId
 * @returns {Array<{pokemonId: number, name: string, type: string}>}
 */
function getTeamForPlayer(tournament, playerId) {
  // Find the player in any duel
  for (const duel of Object.values(tournament.duels)) {
    if (duel.players[playerId]) {
      return duel.players[playerId].team.map((p) => ({
        pokemonId: p.pokemonId,
        name: p.name,
        type: p.type,
      }));
    }
  }
  throw new Error(`Player ${playerId} not found in any duel`);
}

/**
 * Deep clone an object
 * @param {any} obj
 * @returns {any}
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const cloned = {};
  for (const key of Object.keys(obj)) {
    cloned[key] = deepClone(obj[key]);
  }
  return cloned;
}


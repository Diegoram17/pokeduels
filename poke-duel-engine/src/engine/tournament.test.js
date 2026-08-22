// tests/tournament.test.js (fragmento añadido)
it('should reset teams when advancing to final', () => {
  const tournament = createTournament({
    tournamentId: 'reset-test',
    players,
    rng: () => 0.5,
  });

  let state = tournament;
  // Jugar semifinal 1 y causar daño
  const duelId1 = state.rounds[0].duels[0];
  let duel1 = state.duels[duelId1];
  const p1 = Object.keys(duel1.players)[0];
  const p2 = Object.keys(duel1.players)[1];
  duel1 = submitLead(duel1, p1, 0);
  duel1 = submitLead(duel1, p2, 0);
  duel1 = submitAction(duel1, p1, 1); // daño alto
  duel1 = submitAction(duel1, p2, 4);
  const result1 = resolveTurn(duel1, sampleTypeChart, () => 0.1);
  duel1 = result1.state;
  state = reportDuelResult(state, duelId1, duel1.winnerId);

  // Jugar semifinal 2 (no importa el daño)
  const duelId2 = state.rounds[0].duels[1];
  let duel2 = state.duels[duelId2];
  const p3 = Object.keys(duel2.players)[0];
  const p4 = Object.keys(duel2.players)[1];
  duel2 = submitLead(duel2, p3, 0);
  duel2 = submitLead(duel2, p4, 0);
  duel2 = submitAction(duel2, p3, 4);
  duel2 = submitAction(duel2, p4, 4);
  const result2 = resolveTurn(duel2, sampleTypeChart, () => 0.1);
  duel2 = result2.state;
  state = reportDuelResult(state, duelId2, duel2.winnerId);

  // Ahora debe haber final y tercer puesto
  const finalDuelId = state.rounds.find(r => r.round === 'final').duels[0];
  const finalDuel = state.duels[finalDuelId];
  // Verificar que todos los Pokémon de ambos jugadores tienen HP 100
  for (const player of Object.values(finalDuel.players)) {
    for (const pokemon of player.team) {
      expect(pokemon.currentHp).toBe(100);
      expect(pokemon.pp[1]).toBe(4);
      expect(pokemon.pp[2]).toBe(4);
      expect(pokemon.pp[3]).toBe(4);
    }
  }
});
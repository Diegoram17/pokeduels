// Dentro de resolveTurn, en el bucle que aplica switches:
for (const playerId of Object.keys(newState.players)) {
  const switchIdx = newState.pendingSwitches[playerId];
  if (switchIdx !== null && switchIdx !== undefined) {
    const player = newState.players[playerId];
    const fromIdx = player.activeIndex;
    if (fromIdx !== null && fromIdx !== switchIdx) {
      const isForced = player.team[fromIdx]?.fainted || false;
      // ... aplicar cambio
      player.activeIndex = switchIdx;
      events.push({
        type: 'switch',
        playerId,
        fromIndex: fromIdx,
        toIndex: switchIdx,
        forced: isForced, // <-- ahora refleja si fue forzado
      });
    }
  }
}
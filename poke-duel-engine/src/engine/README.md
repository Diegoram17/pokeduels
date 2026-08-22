# src/engine/README.md

# Motor de Combate Pokémon

Motor puro de JavaScript para duelos por turnos estilo Pokémon, con reglas simplificadas.

## Uso

### Creación de un duelo

```javascript
import { createDuel, submitLead, submitAction, resolveTurn } from './engine/index.js';

const duel = createDuel({
  duelId: 'duel-123',
  player1Id: 'jugador1',
  player1Team: [
    { pokemonId: 25, name: 'Pikachu', type: 'electric' },
    // ... 6 Pokémon
  ],
  player2Id: 'jugador2',
  player2Team: [
    { pokemonId: 6, name: 'Charizard', type: 'fire' },
    // ... 6 Pokémon
  ],
});

// Elegir Pokémon inicial
let state = submitLead(duel, 'jugador1', 0);
state = submitLead(state, 'jugador2', 0);

// Elegir ataques
state = submitAction(state, 'jugador1', 1);
state = submitAction(state, 'jugador2', 2);

// Resolver el turno
const result = resolveTurn(state, typeChart, () => Math.random());
const { state: newState, events } = result;
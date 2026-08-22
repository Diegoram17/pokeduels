# Tech Design — Pokémon Duels (v1)

**Documento asociado:** `PRD.md`
**Tipo de proyecto:** Greenfield (sin repo de código existente)
**Design.md disponible:** Sí — `DESIGN.md` + prototipos HTML en `Prototipos/`
**Estado:** Listo para implementación
**Stack:** React + Vite + Tailwind (Vercel) · Node.js + Express + Socket.IO (Render) · PostgreSQL (Neon)
**Decisiones de arquitectura:** ver `adrs/0001` a `0007`, resumidas en la sección 11

---

## 1. Contexto y alcance técnico

Se implementa un juego multijugador por turnos con estado autoritativo en servidor. El desafío técnico central no es el volumen de tráfico (salas de 2–4 jugadores), sino la **consistencia del estado de combate en tiempo real** entre clientes, con resolución simultánea de acciones y timeouts.

**Decisión rectora:** el servidor es la única fuente de verdad del combate. El cliente nunca calcula daño, nunca decide K.O., nunca determina orden de turno. El cliente envía *intenciones* (`quiero atacar con el movimiento 2`) y renderiza *resultados* emitidos por el servidor.

## 2. Arquitectura general

```
Frontend — React + Vite + Tailwind (Vercel)
Backend  — Node + Express + Socket.IO (Render)

Frontend ──HTTPS/REST──► Backend    (sesión, lobby, catálogo, salas)
Frontend ◄──WebSocket──► Backend    (estado de duelo en vivo)
Frontend ──GET sprites──► PokeAPI   (sprites de los 54 pokémon)
Backend  ──SQL──────────► PostgreSQL/Neon
```

**División REST vs WebSocket:**
- **REST:** todo lo que no requiere tiempo real — sesión efímera por nickname, listar salas, crear sala, catálogo de pokémon.
- **WebSocket:** todo lo que ocurre dentro de una sala activa — ready, selección de inicial (por la exclusividad), selección de acción, resolución de turno, timeouts, desconexiones, avance de bracket.

## 3. Modelo de datos

### 3.1 Esquema

```sql
-- Jugadores (identidad efímera por nickname, sin cuentas persistentes)
CREATE TABLE players (
  id            SERIAL PRIMARY KEY,
  nickname      VARCHAR(30) NOT NULL,
  session_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);
-- Nota: el nickname NO es único globalmente (dos personas pueden llamarse igual
-- en salas distintas). La unicidad se aplica solo dentro de una sala (ver room_players).

-- Catálogo canónico de tipos (18) — evita typos sueltos en pokemons/type_effectiveness
CREATE TABLE types (
  name VARCHAR(20) PRIMARY KEY
);

-- Catálogo estático (seed: 4 iniciales + 50 del catálogo)
CREATE TABLE pokemons (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) UNIQUE NOT NULL,
  type        VARCHAR(20) NOT NULL REFERENCES types(name),  -- tipo único
  pokeapi_id  INTEGER NOT NULL,            -- para construir URL del sprite
  sprite_url  TEXT,                        -- cacheado en seed
  is_starter  BOOLEAN DEFAULT FALSE
);

-- Matriz de efectividad de tipos (18×18 completa, ver ADR-0007)
CREATE TABLE type_effectiveness (
  attacking_type VARCHAR(20) NOT NULL REFERENCES types(name),
  defending_type VARCHAR(20) NOT NULL REFERENCES types(name),
  multiplier     NUMERIC(2,1) NOT NULL CHECK (multiplier IN (2.0, 1.0, 0.5)),
  PRIMARY KEY (attacking_type, defending_type)
);

-- Salas
CREATE TABLE rooms (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(8) UNIQUE NOT NULL,  -- código corto para unirse
  max_players SMALLINT NOT NULL CHECK (max_players IN (2,4)),
  status      VARCHAR(20) DEFAULT 'waiting',  -- waiting|in_progress|finished|aborted
  created_by  INTEGER REFERENCES players(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE room_players (
  id        SERIAL PRIMARY KEY,
  room_id   INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id),
  nickname  VARCHAR(30) NOT NULL,          -- copia para validar unicidad en sala
  ready     BOOLEAN DEFAULT FALSE,
  connected BOOLEAN DEFAULT TRUE,
  final_rank SMALLINT,                     -- 1..4, se llena al terminar
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (room_id, player_id),
  UNIQUE (room_id, nickname)               -- no dos nicknames iguales en la misma sala
);

-- Equipos elegidos
CREATE TABLE team_selections (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  player_id  INTEGER REFERENCES players(id),
  pokemon_id INTEGER REFERENCES pokemons(id),
  is_starter BOOLEAN DEFAULT FALSE,
  slot       SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 6),
  UNIQUE (room_id, player_id, slot),
  UNIQUE (room_id, player_id, pokemon_id)  -- sin repetidos dentro del propio equipo
);

-- Exclusividad del inicial a nivel de BD:
-- un mismo starter no puede repetirse entre jugadores de la misma sala
CREATE UNIQUE INDEX uq_starter_por_sala
  ON team_selections (room_id, pokemon_id)
  WHERE is_starter = TRUE;

-- Duelos 1v1 dentro del torneo
CREATE TABLE duels (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  player1_id INTEGER REFERENCES players(id),
  player2_id INTEGER REFERENCES players(id),
  round      VARCHAR(20) NOT NULL,        -- unica|semifinal|final|tercer_puesto
  winner_id  INTEGER REFERENCES players(id),
  status     VARCHAR(20) DEFAULT 'pending', -- pending|in_progress|finished
  end_reason VARCHAR(20),                  -- ko|disconnect|surrender|server_restart
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Estado vivo de cada pokémon durante un duelo
CREATE TABLE duel_pokemon_state (
  id         SERIAL PRIMARY KEY,
  duel_id    INTEGER REFERENCES duels(id) ON DELETE CASCADE,
  player_id  INTEGER REFERENCES players(id),
  pokemon_id INTEGER REFERENCES pokemons(id),
  current_hp SMALLINT NOT NULL DEFAULT 100,
  pp_move_1  SMALLINT NOT NULL DEFAULT 4,  -- daño 25
  pp_move_2  SMALLINT NOT NULL DEFAULT 4,  -- daño 20
  pp_move_3  SMALLINT NOT NULL DEFAULT 4,  -- daño 15
  -- move_4 (daño 10) no lleva PP: ilimitado
  is_active  BOOLEAN DEFAULT FALSE,        -- el que está en campo
  fainted    BOOLEAN DEFAULT FALSE,
  UNIQUE (duel_id, player_id, pokemon_id)
);

-- Log de acciones (auditoría + replay del turno)
CREATE TABLE moves (
  id                SERIAL PRIMARY KEY,
  duel_id           INTEGER REFERENCES duels(id) ON DELETE CASCADE,
  turn_number       INTEGER NOT NULL,
  player_id         INTEGER REFERENCES players(id),
  action_type       VARCHAR(10) NOT NULL,  -- attack|switch
  pokemon_id        INTEGER REFERENCES pokemons(id),
  move_index        SMALLINT,              -- 1..4 si action_type='attack'
  target_pokemon_id INTEGER REFERENCES pokemons(id),
  damage_dealt      SMALLINT,
  effectiveness     NUMERIC(2,1),          -- 2.0|1.0|0.5
  was_timeout       BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Notas de diseño del modelo

- **`type_effectiveness` como tabla, no como constante en código.** Permite ajustar el balance sin redeploy y es consultable desde el frontend para mostrar hints al jugador.
- **`duel_pokemon_state` se crea al iniciar cada duelo**, copiando el equipo de `team_selections`. Esto significa que en el bracket de 4 jugadores, **cada duelo arranca con los pokémon a full HP y PP** — no se arrastra el desgaste entre rondas del torneo (ver ADR-0007).
- **`moves` es append-only** y permite reconstruir la secuencia de un duelo. En v1 no existe pantalla de historial, pero la tabla se mantiene para depuración y para animar correctamente la resolución de cada turno en el cliente.
- **Sin cuentas persistentes:** `players` es una tabla de identidades efímeras. Se puede correr un job de limpieza que elimine registros con `last_seen_at` antiguo.
- **Avatares:** los prototipos muestran un avatar por jugador en el lobby, pero no hay campo nuevo — se genera 100% en el cliente a partir del nickname (iniciales + color derivado de un hash), sin persistir nada.

## 4. Motor de combate (servidor)

### 4.1 Constantes

```js
const HP_BASE = 100;
const MOVE_DAMAGE = { 1: 25, 2: 20, 3: 15, 4: 10 };
const MOVE_PP     = { 1: 4,  2: 4,  3: 4,  4: Infinity };
const TURN_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MOVE = 4;  // el más débil
```

### 4.2 Cálculo de daño

```js
function calcularDaño(tipoAtacante, tipoDefensor, moveIndex) {
  const base = MOVE_DAMAGE[moveIndex];
  const mult = getMultiplicador(tipoAtacante, tipoDefensor); // 2.0 | 1.0 | 0.5
  if (mult === undefined) {
    // Con la FK a `types` (TECH-DESIGN §3.1) esto no debería ocurrir con datos válidos;
    // si ocurre, es un bug de seed — fallar ruidosamente, nunca devolver daño corrupto (NaN).
    throw new Error(`type_effectiveness sin definir: ${tipoAtacante} → ${tipoDefensor}`);
  }
  const daño = Math.floor(base * mult);
  return Math.max(1, daño);   // nunca 0
}
```

### 4.3 Máquina de estados del duelo

```
        ┌──────────────────┐
        │  AWAITING_LEAD   │  ambos eligen su pokémon inicial del duelo
        └────────┬─────────┘
                 ▼
        ┌──────────────────┐
        │  AWAITING_SWITCH │  ◄── se ofrece cambio (inicio o post-KO)
        └────────┬─────────┘
                 ▼  (se revelan cambios a ambos)
        ┌──────────────────┐
        │ AWAITING_ACTIONS │  ambos eligen ataque en simultáneo (10s timeout)
        └────────┬─────────┘
                 ▼
        ┌──────────────────┐
        │    RESOLVING     │  orden aleatorio → daño → KO check
        └────────┬─────────┘
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
  hay KO?  sí ───► AWAITING_SWITCH
       │
       no ──────► AWAITING_ACTIONS
       │
       ▼
  ¿equipo sin pokémon vivos? ──► DUEL_FINISHED
```

### 4.4 Resolución de una ronda (pseudocódigo)

```js
function resolverRonda(duel, accionP1, accionP2) {
  const eventos = [];

  // 1. Orden aleatorio
  const [primero, segundo] = Math.random() < 0.5
    ? [accionP1, accionP2]
    : [accionP2, accionP1];

  for (const accion of [primero, segundo]) {
    const atacante = getActivePokemon(duel, accion.userId);

    // 2. Si el atacante ya murió en esta misma ronda, no ataca
    if (atacante.fainted) {
      eventos.push({ tipo: 'turno_cancelado', userId: accion.userId });
      continue;
    }

    // 3. Validar PP
    if (!tienePP(atacante, accion.moveIndex)) {
      accion.moveIndex = DEFAULT_TIMEOUT_MOVE; // fallback al ilimitado
    }

    const defensor = getActivePokemon(duel, rivalDe(accion.userId));
    const daño = calcularDaño(atacante.type, defensor.type, accion.moveIndex);

    // 4. Aplicar
    consumirPP(atacante, accion.moveIndex);
    defensor.current_hp = Math.max(0, defensor.current_hp - daño);
    if (defensor.current_hp === 0) defensor.fainted = true;

    eventos.push({ tipo: 'ataque', atacante, defensor, daño, ... });
    persistirMove(duel, accion, daño);
  }

  return eventos;
}
```

### 4.5 Reglas críticas implementadas

| Regla | Implementación |
|---|---|
| Orden aleatorio | `Math.random()` al inicio de la ronda, en servidor |
| K.O. cancela el turno del muerto | Check `atacante.fainted` antes de ejecutar la segunda acción |
| Ataque débil ilimitado | `MOVE_PP[4] = Infinity`, nunca se decrementa |
| Sin PP → fallback | Si los 3 primeros están agotados, se fuerza `moveIndex = 4` |
| Daño mínimo 1 | `Math.max(1, ...)` tras el redondeo |
| Pokémon entrante ataca esa ronda | El switch se resuelve **antes** de la fase de acciones, no consume la ronda |
| Timeout 10s | Timer en servidor por ronda; al expirar inyecta `{action:'attack', moveIndex:4, was_timeout:true}` |

## 5. Contratos de API

### 5.1 REST

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/session` | Crear sesión con nickname → devuelve `{ playerId, sessionToken }` |
| `GET` | `/api/pokemons` | Catálogo (50 + 4 starters) con tipo y sprite |
| `GET` | `/api/type-effectiveness` | Matriz de tipos (para hints en UI) |
| `GET` | `/api/rooms` | Salas en estado `waiting` con ocupación actual |
| `POST` | `/api/rooms` | Crear sala (`max_players: 2\|4`) → devuelve `code` |
| `POST` | `/api/rooms/:code/join` | Unirse a sala por código (valida nickname único en sala) |

### 5.2 Eventos WebSocket

**Canales:** cada evento de sala (`room:*`, `tournament:*`) se emite a la room de Socket.IO
`room:{roomId}`; cada evento de duelo (`duel:*`) se emite a `duel:{duelId}`, no a la sala completa
— necesario porque un torneo de 4 corre 2 duelos en paralelo dentro de la misma sala (ADR-0004).

**Cliente → Servidor**

| Evento | Payload | Notas |
|---|---|---|
| `room:join` | `{ roomId, sessionToken }` | Suscribe al canal de la sala |
| `team:select_starter` | `{ roomId, pokemonId }` | Puede fallar por exclusividad |
| `team:select_roster` | `{ roomId, pokemonIds[5] }` | |
| `room:ready` | `{ roomId }` | |
| `room:leave` | `{ roomId }` | Libera el starter reservado |
| `duel:select_lead` | `{ duelId, pokemonId }` | Pokémon inicial del duelo |
| `duel:switch_decision` | `{ duelId, switchTo: pokemonId \| null }` | `null` = mantiene el actual |
| `duel:select_action` | `{ duelId, moveIndex }` | Sujeto a timeout de 10s |
| `duel:surrender` | `{ duelId }` | RF-5.5, pide confirmación en cliente antes de emitirse |

**Servidor → Cliente**

| Evento | Payload | Notas |
|---|---|---|
| `room:state` | `{ players[], readyStates, startersTaken[] }` | Se emite en cada cambio |
| `team:starter_rejected` | `{ pokemonId, reason: 'taken' }` | Perdió la carrera |
| `team:roster_rejected` | `{ reason: 'invalid_count' \| 'duplicate' \| 'not_in_catalog' }` | Respuesta a un `team:select_roster` inválido |
| `tournament:bracket` | `{ duels[] }` | Emparejamientos generados |
| `duel:start` | `{ duelId, opponent, yourTeam }` | |
| `duel:awaiting_switch` | `{ duelId, availablePokemon[] }` | |
| `duel:field_update` | `{ yourActive, opponentActive }` | Tras revelar cambios |
| `duel:awaiting_actions` | `{ duelId, deadline, availableMoves[] }` | Arranca el contador de 10s |
| `duel:turn_resolved` | `{ eventos[], estadoActualizado }` | Secuencia animable |
| `duel:finished` | `{ winnerId, endReason }` | |
| `duel:opponent_disconnected` | `{ duelId }` | Victoria automática |
| `tournament:awaiting_round` | `{ nextRound, pendingDuels[] }` | El jugador vuelve a P4 a esperar |
| `room:final_ranking` | `{ ranking[] }` | Cierre del torneo |
| `room:aborted` | `{ reason: 'server_restart' }` | Sala anulada por reconciliación de arranque (ADR-0008); el cliente vuelve a P2 |

## 6. Manejo de casos borde

| Caso | Comportamiento |
|---|---|
| Dos jugadores confirman el mismo starter simultáneamente | El índice único de BD hace fallar al segundo; se le emite `team:starter_rejected` y debe reelegir |
| Jugador no elige acción en 10s | Auto-ataque con movimiento 4, marcado `was_timeout=true` |
| Ambos jugadores hacen timeout | Ambos auto-atacan; la ronda se resuelve normal |
| Jugador se desconecta a mitad de duelo | Rival gana, `end_reason='disconnect'`; si es torneo de 4, el bracket avanza igual |
| **Timeout durante un cambio forzado (post-K.O.)** | El timer de 10s también aplica aquí. Si expira, el servidor envía automáticamente el **primer pokémon vivo por orden de slot** |
| Jugador se desconecta y vuelve a conectar | v1: no hay reconexión, el duelo ya está cerrado *(mejora futura)* |
| Todos los pokémon del jugador K.O. | `duel:finished`, se determina ganador |
| Un pokémon queda sin PP en los 3 movimientos limitados | Solo puede usar el movimiento 4; la UI deshabilita los otros |
| Sala se queda a medias (alguien sale antes del ready) | La sala vuelve a `waiting` y libera el starter reservado |
| Cold start de Render corta el socket | El cliente reintenta la conexión con backoff |
| Jugador refresca el navegador a mitad del draft | Se recupera `sessionToken` de `sessionStorage` y se re-suscribe a la sala; su starter reservado sigue siendo suyo |
| Jugador se desconecta en lobby/draft y no reconecta en 60s | El servidor lo remueve de la sala, libera su starter reservado y notifica al resto (RF-2.7) |
| Backend se reinicia con duelos `in_progress` | Reconciliación al arrancar: esos duelos pasan a `finished`/`end_reason='server_restart'`, la sala a `status='aborted'`; al reconectar, el cliente recibe `room:aborted` y vuelve a P2 (ADR-0008) |
| Dos jugadores intentan entrar a la misma sala con el mismo nickname | El segundo es rechazado por el constraint `UNIQUE (room_id, nickname)` y debe cambiarlo |
| Jugador gana su duelo pero el otro duelo del bracket sigue en curso | Se emite `tournament:awaiting_round` y vuelve a P4 con estado de espera visible |

## 7. Consideraciones de seguridad

Sin auth tradicional, el modelo de amenazas cambia: no hay credenciales que proteger, pero sí hay que evitar que un jugador actúe en nombre de otro o manipule el combate.

- **Token de sesión efímero:** al ingresar el nickname, el servidor emite un `sessionToken` (UUID). Ese token —no el nickname— identifica al jugador en cada evento. El nickname es solo una etiqueta visual y **nunca** se usa como identificador de autoridad.
- **Autoridad del servidor:** el cliente nunca envía daño ni HP. Envía `moveIndex`; el servidor valida que ese movimiento exista, que tenga PP, y que el pokémon esté activo y vivo.
- **Validación de pertenencia:** cada evento de duelo verifica que el `playerId` derivado del `sessionToken` sea participante de ese `duelId`.
- **Anti-anticipación:** las acciones de ronda se almacenan en servidor sin emitirse hasta que ambos jugadores enviaron la suya (o expiró el timeout). Esto garantiza la simultaneidad real.
- **Nickname sanitizado:** limitar longitud, escapar HTML al renderizar (evita XSS por nickname) y validar unicidad dentro de la sala.
- **Rate limiting** en `POST /api/session` y `POST /api/rooms` para evitar creación masiva de salas o sesiones.

> **Nota de alcance:** al no haber cuentas, cualquiera que obtenga un `sessionToken` puede actuar como ese jugador. Es un riesgo aceptado en v1 dado que las partidas son efímeras y no hay nada de valor asociado a la identidad.

## 8. Plan de implementación por fases

### Fase 1 — Fundaciones (sin tiempo real)
- Esquema de BD + migraciones + seed del catálogo (50 pokémon + matriz de tipos)
- Endpoint de sesión por nickname (`POST /api/session`)
- Endpoints REST de catálogo y salas
- Frontend: **P1 (Nickname)**, **P2 (Lobby)**, **P3 (Draft)** sin exclusividad en tiempo real aún

### Fase 2 — Motor de combate offline
- Implementar `calcularDaño`, `resolverRonda`, máquina de estados
- **Tests unitarios del motor** (ver sección 9) — antes de conectar WebSocket
- Modo local "hot seat" para probar reglas sin red
- Frontend: **P5 (Tablero)** y **Modal A** maquetados con datos simulados

### Fase 3 — Tiempo real
- Servidor WebSocket + canales por sala
- Exclusividad del starter con constraint + rechazo (bloqueo visual "Tomado" en P3)
- Ciclo completo de duelo 1v1 con timeout de 10s visible
- Manejo de desconexión durante el duelo (derrota automática) y reconexión básica en lobby/draft vía `sessionStorage`

### Fase 4 — Torneo y cierre
- **P4 (Sala de espera / Bracket)** con árbol de torneo
- Bracket de 4 jugadores (semifinal → final / tercer puesto) y espera entre rondas
- **Modal B (Ranking final)** con podio
- Pulido visual, animaciones de daño, feedback de efectividad

## 9. Estrategia de testing

**Tests unitarios del motor (prioritarios, sin red ni BD):**
- Daño neutral: movimiento 1 contra tipo neutral → 25
- Ventaja: movimiento 1 con ×2 → 50
- Desventaja con redondeo: movimiento 3 (15) con ×0.5 → 7
- Daño mínimo: cualquier cálculo que dé < 1 → 1
- PP: movimiento 4 no decrementa nunca
- Fallback: sin PP en 1/2/3 → fuerza movimiento 4
- K.O. cancela turno: si el primero mata, el segundo no registra daño
- Fin de duelo: 6 pokémon K.O. → `duel:finished`

**Tests de integración:**
- Dos clientes concurrentes eligiendo el mismo starter → solo uno gana
- Timeout de 10s dispara auto-ataque
- Desconexión otorga victoria

## 10. Decisiones cerradas y pendientes

| # | Decisión | Resolución |
|---|---|---|
| 1 | ¿El estado de HP/PP se arrastra entre duelos del bracket? | **Cerrado (ADR-0007):** no se arrastra, cada duelo a full HP/PP |
| 2 | ¿Reconexión tras desconexión? | **Cerrado:** fuera de v1 durante el duelo activo; sí en lobby/draft con timeout de 60s (RF-2.7) |
| 3 | Lista final de los 50 pokémon y sus tipos | Pendiente de definir (curación de contenido, no de arquitectura) |
| 4 | ¿Matriz de tipos completa (18×18) o solo los tipos presentes? | **Cerrado (ADR-0007):** completa |

## 11. Decisiones de arquitectura (ADRs)

Generadas de forma interactiva con la skill `generar-tech-design` — cada una registra el contexto,
las alternativas reales consideradas y el trade-off aceptado, no solo la decisión final.

| # | Decisión | Estado |
|---|---|---|
| [ADR-0001](adrs/0001-componentes-repos.md) | Componentes y estructura de repos (monorepo, backend único) | Aceptado |
| [ADR-0002](adrs/0002-modelo-de-datos.md) | Modelo de datos (schema relacional normalizado, sin ranking persistente) | Aceptado |
| [ADR-0003](adrs/0003-contratos-de-api.md) | Contratos de API (híbrido REST + WebSocket) | Aceptado |
| [ADR-0004](adrs/0004-stack-por-componente.md) | Stack por componente (React+Vite, Express+Socket.IO) | Aceptado |
| [ADR-0005](adrs/0005-manejo-de-estado.md) | Manejo de estado (duelo en memoria, persistencia async) | Aceptado |
| [ADR-0006](adrs/0006-resiliencia-cold-start.md) | Resiliencia — mitigación del cold start de Render | Aceptado |
| [ADR-0007](adrs/0007-arrastre-estado-y-matriz-tipos.md) | Arrastre de estado entre duelos y cobertura de la matriz de tipos | Aceptado |
| [ADR-0008](adrs/0008-reconciliacion-duelos-huerfanos.md) | Reconciliación de duelos y torneos huérfanos tras reinicio del backend | Aceptado |

## 12. Criterios de aceptación por flujo

Más granulares que los RF del PRD — pensados como checklist verificable durante el desarrollo.
Algunos requirieron una interpretación de criterio (marcados abajo); si alguno no refleja lo que
esperás, decímelo y lo ajusto.

### Identidad y sesión

- [ ] `POST /api/session` con nickname vacío o de más de 30 caracteres devuelve 400 y no crea `players`.
- [ ] El `sessionToken` emitido es un UUID y viaja en cada evento WS subsecuente.
- [ ] Un evento WS cuyo `sessionToken` no pertenece al `playerId` dueño de la sala/duelo es rechazado (RNF-3, §7).
- [ ] Sin `sessionStorage` previo, entrar de nuevo crea un `player` nuevo — nunca recupera el anterior (RF-1.5).

### Salas y lobby

- [ ] `POST /api/rooms` con `max_players` fuera de `{2,4}` devuelve 400 (constraint `CHECK` ya en schema).
- [ ] `GET /api/rooms` no devuelve salas en estado `in_progress` o `finished`.
- [ ] Unirse a una sala llena devuelve error explícito y no inserta un `room_players` de más (RF-2.4).
- [ ] `room:ready` solo dispara el inicio cuando **todos** los `room_players.ready = true` y la sala está completa (RF-2.5).
- [ ] Un jugador desconectado que no vuelve en 60s dispara la remoción automática + liberación del starter + `room:state` actualizado al resto (RF-2.7).

### Draft de equipo

- [ ] Dos clientes reservando el mismo starter en simultáneo: `uq_starter_por_sala` rechaza al segundo con `team:starter_rejected` (RF-3.2).
- [ ] `team:select_roster` con una cantidad de `pokemonIds` distinta de 5, con duplicados, o con IDs fuera del catálogo, responde `team:roster_rejected` con el motivo correspondiente — nunca falla en silencio.
- [ ] `room:ready` solo se acepta con exactamente 6 pokémon en `team_selections` (RF-3.4).

### Combate

- [ ] `duel:select_action` con `moveIndex` fuera de 1-4, o sobre un movimiento sin PP, se rechaza o se fuerza al movimiento 4 según corresponda (RF-4.2, RF-4.3).
- [ ] <!-- interpretación: "verificable" se toma como test estadístico sobre N rondas, no determinístico --> El orden de resolución dentro de una ronda es aleatorio, verificado con un test estadístico sobre múltiples rondas (RF-4.7).
- [ ] Un pokémon con `fainted=true` no ejecuta su acción aunque la haya enviado antes de caer en la misma ronda (RF-4.8).
- [ ] `duel:surrender` en un duelo `in_progress` lo termina con `end_reason='surrender'` y `winner_id` = rival (RF-5.5).
- [ ] Ningún payload cliente→servidor de combate lleva daño o HP — solo `moveIndex`/`switchTo` (RNF-3, RF-4.12).
- [ ] Un par de tipos sin entrada en `type_effectiveness` hace que `calcularDaño` lance un error explícito, nunca que devuelva `NaN` o daño silenciosamente incorrecto.
- [ ] Los dos duelos concurrentes de un torneo de 4 no se cruzan: un cliente en el `duelId` A nunca recibe eventos `duel:*` del `duelId` B (ADR-0004, rooms de Socket.IO por duelo).

### Fin de duelo y torneo

- [ ] `duel:finished` se emite exactamente cuando los 6 pokémon de un jugador tienen `fainted=true` (RF-5.1).
- [ ] En torneo de 4, `tournament:bracket` empareja los 2 duelos al azar y separa ganadores/perdedores en la ronda siguiente (RF-5.3).
- [ ] `room:final_ranking` se emite una única vez por sala, con las 4 posiciones completas (RF-5.4).
- [ ] Cada duelo del bracket arranca con HP/PP completos, sin arrastrar el desgaste del duelo anterior (ADR-0007).

### Tiempo real y resiliencia

- [ ] Sin acción en 10s, el servidor aplica auto-ataque con `moveIndex=4` y `was_timeout=true` (RF-6.1).
- [ ] La desconexión del socket durante un duelo `in_progress` dispara `duel:opponent_disconnected` + victoria automática del rival (RF-6.2).
- [ ] `/health` responde 200 sin tocar la base de datos; el cron externo lo llama en el intervalo configurado (ADR-0006).
- [ ] Al arrancar, el backend anula todo `duel`/`room` que haya quedado en `in_progress`, sin excepción, antes de aceptar conexiones nuevas (ADR-0008).
- [ ] Un cliente que reconecta a una sala `aborted` recibe `room:aborted` y no `room:state`, y el frontend lo redirige a P2 sin permitir reintentar el mismo duelo.
- [ ] Al llegar `rooms.status` a `finished` o `aborted`, el backend libera de memoria el estado de esa sala/duelo poco después de emitir el evento final — no se acumula indefinidamente durante la vida del proceso (ADR-0005).

## Riesgos técnicos abiertos

- ~~Si el backend se reinicia a mitad de un duelo, el estado en memoria de ese duelo se pierde (ADR-0005) — los jugadores lo perciben como si el rival se hubiera desconectado.~~ **Corregido:** ese razonamiento era incorrecto — sin un proceso vivo no hay quién emita `duel:opponent_disconnected`. Resuelto por la reconciliación de arranque (ADR-0008): duelos/salas huérfanos se anulan explícitamente en vez de quedar en un estado indefinido. Sigue faltando logging/alerting que avise cuándo ocurre un reinicio con partidas en curso.
- El cron de health check (ADR-0006, ahora un servicio dedicado en vez de GitHub Actions) sigue siendo una pieza externa de terceros — si tiene downtime o nadie configura una alerta sobre pings fallidos, el cold start reaparece igual, aunque ya no por la desactivación silenciosa a 60 días que tenía la alternativa descartada.
- La curación del catálogo final de 50 pokémon y sus tipos sigue pendiente (TECH-DESIGN §10, ítem 3) y bloquea el seed de `pokemons`/`type_effectiveness`.

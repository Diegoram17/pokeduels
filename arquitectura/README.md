# Diagramas de arquitectura — PokeDuels

Cuatro vistas del sistema completo (monorepo `frontend/` + `backend/`). Abrir los `.drawio`
con [diagrams.net](https://app.diagrams.net) (o la extension de VS Code "Draw.io Integration").

| Archivo | Vista | Qué muestra |
|---|---|---|
| `pokeduels_diagrama_clases.drawio` | Clases / modelo de dominio | Las 10 tablas persistidas (migraciones `0001`–`0005`) como clases con atributos, tipos, restricciones y asociaciones con multiplicidad. |
| `pokeduels_diagrama_capas.drawio` | Estilo de capas | Las 7 capas del stack (presentacion → estado de cliente → transporte → aplicacion → dominio → acceso a datos → persistencia) y la dependencia estricta hacia abajo. |
| `pokeduels_diagrama_cc_niveles.drawio` | Componente-y-Conector por niveles | Componentes en ejecucion y sus conectores (llamada-retorno REST, publicacion-suscripcion Socket.IO, `pool.query`), agrupados por nivel. |
| `pokeduels_diagrama_despliegue.drawio` | Despliegue / asignacion | Nodos fisicos (navegador, Vercel, Render, Neon), los artefactos/componentes asignados a cada uno y los protocolos entre ellos. |

## Mapa diagrama → código

### Modelo de dominio (clases)
Fuente unica: `backend/migrations/0001_initial-schema.sql` + deltas `0002`–`0005`.
- `players` (`0004` agrega `is_bot`) · `types` · `pokemons` (`0002` agrega `back_sprite_url`) · `type_effectiveness`
- `rooms` · `room_players` · `team_selections` (+ indice parcial `uq_starter_por_sala`)
- `duels` (`0003` agrega `walkover` a `end_reason`) · `duel_pokemon_state` · `moves`

El estado transitorio de **fases del duelo** (`lead_selection` / `awaiting_actions` /
`awaiting_switch` / `RESOLVING`) **no se persiste**: vive en memoria del servidor
(`backend/ws/duelContext.js` → `phaseStore` + `roundState`, uno por conexion) y en el
cliente se deriva con `deriveDuelPhase()` (`frontend/src/state/store.ts`).

### Capas
1. **Presentacion** — `frontend/src/routes/*`, `frontend/src/components/*`, `assets/pokeduels-design-system.css`
2. **Estado de cliente** — `frontend/src/state/MockStateProvider.tsx`, `store.ts`, `schema.ts`, `hooks/useDuelSocket.ts`, `hooks/useMockPersistence.ts`
3. **Transporte / borde** — cliente: `frontend/src/lib/socket.ts`, `lib/api.ts` · servidor: `backend/app.js`, `backend/ws/index.js`, `backend/middleware/*`
4. **Aplicacion (handlers)** — `backend/ws/duelContext.js` (raiz de composicion), `ws/roomHandlers.js`, `ws/teamHandlers.js`, `ws/duelHandlers.js`, `ws/turnCycle.js`, `ws/tournamentLifecycle.js`, `ws/duelLifecycle.js`, `ws/duelBootstrap.js`, `ws/botManager.js`, `routes/*`
5. **Dominio (motor puro)** — `backend/engine/roundResolver.js`, `engine/stateMachine.js`, `engine/switchValidation.js`, `engine/damageCalc.js`, `engine/typeEffectiveness.js`, `engine/duelPhaseStore.js`
6. **Acceso a datos** — `backend/repositories/duelRepository.js` (barrel) → `duelQueries.js`, `duelTransactions.js`, `duelStateMapper.js` · `backend/db/rooms.js`, `db/teamSelections.js`, `db/players.js`, `db/pokemons.js`, `db/reconciliation.js`
7. **Persistencia** — `backend/db/pool.js` + PostgreSQL/Neon + `backend/migrations/*`

### Despliegue
- **Navegador** ← sirve la SPA desde **Vercel** (`frontend/dist/`, deploy auto en push a `master`).
- **Render** corre un unico proceso `node backend/server.js` = Express (REST `/api/*` + `/health`) + Socket.IO (WSS) + motor de duelo, todo in-process.
- **Neon** (PostgreSQL serverless) accedido via `pg` pool (`DATABASE_URL`). En CI cada corrida usa una rama efimera de Neon.
- Cron externo golpea `GET /health` para evitar el spin-down del free tier de Render (ADR-0006).

> Referencia de decisiones: `PRD.md`, `TECH-DESIGN.md`, `DEPLOY-PLAN.md`, `adrs/`.

# PokeDuels

Duelos Pokémon en tiempo real, **1v1 y torneo de 4 jugadores**. Elegí un inicial exclusivo
más un plantel de 5 Pokémon, combatí turno a turno usando ventajas de tipo y noqueá a las
seis unidades del rival para ganar. Sin niveles, sin objetos — pura estrategia de tipos. Las
identidades son efímeras (solo un apodo, sin cuentas).

- **Jugar:** <https://pokeduels.vercel.app>
- **API:** <https://pokeduels-backend.onrender.com>

**Estado:** completamente implementado y desplegado. Fases 1–7 de producto y Fases 1–6 de
diagnóstico están mergeadas a `master` — ver [`BACKLOG.md`](BACKLOG.md) para el historial
ítem por ítem.

---

## Arquitectura de un vistazo

Monorepo con **dos paquetes npm independientes** y sin `package.json` en la raíz.

| Parte | Stack | Corre en |
|---|---|---|
| `frontend/` | Vite 8 · React 19 · React Router 6 · Tailwind 4 · socket.io-client · **TypeScript** | Vercel (SPA estática) |
| `backend/` | Express 5 (REST) · Socket.IO 4 (WS) · `pg` · node-pg-migrate · **JS plano (ESM)** | Render (un proceso Node) |
| Base de datos | PostgreSQL — 10 tablas, 5 migraciones | Neon (serverless; branch efímero por corrida de CI) |

- **El motor de combate es autoritativo del servidor.** `backend/engine/` es puro (sin I/O):
  resuelve cada ronda — orden, daño, KO, condiciones de fin — y el cliente solo renderiza los
  snapshots que recibe por WebSocket. El cliente nunca calcula un resultado.
- **El estado de fase del duelo no se persiste.** `lead_selection` / `awaiting_actions` /
  `awaiting_switch` / `RESOLVING` viven en memoria del servidor (`backend/ws/duelContext.js`,
  un store por conexión); el cliente re-deriva la fase con `deriveDuelPhase()`.
- **El transporte es híbrido:** REST para sesión / catálogo / creación de sala, Socket.IO para
  todo lo que es en vivo (`room:*`, `team:*`, `duel:*`).

Los diagramas completos — modelo de clases, vista en capas, componentes y conectores,
despliegue — viven en [`arquitectura/`](arquitectura/README.md).

---

## Estructura del repositorio

```
.
├── frontend/                 SPA de React            → ver frontend/README.md
├── backend/                  API Express + Socket.IO + motor de juego
├── arquitectura/             Diagramas de arquitectura (.drawio) + README
├── adrs/                     Architecture Decision Records (0001–0012)
├── Prototipos/               Prototipos HTML/CSS originales de cada pantalla (referencia de diseño)
├── scripts/                  Tooling del repo (sync-seed-data.mjs)
├── seed-data.json            Catálogo curado del seed (150 pokémon)
├── .github/workflows/ci.yml  CI: build + test + lint para ambos paquetes
└── *.md                      Documentación del proyecto (indexada más abajo)
```

### Interior de `backend/`

| Carpeta | Responsabilidad |
|---|---|
| `app.js` / `server.js` | Factory de la app Express · bootstrap de HTTP + Socket.IO · apagado ordenado · reconciliación al arrancar |
| `ws/` | Capa de WebSocket — `index.js` (composition root), `duelContext.js`, handlers de sala/equipo/duelo, `turnCycle.js`, `tournamentLifecycle.js`, `botManager.js`, registros de timers |
| `routes/` | REST — `session.js`, `rooms.js`, `catalog.js` |
| `engine/` | Lógica de juego pura — `roundResolver.js`, `stateMachine.js`, `switchValidation.js`, `damageCalc.js`, `typeEffectiveness.js` |
| `repositories/` | Acceso a datos — `duelRepository.js` como barrel sobre `duelQueries.js` / `duelTransactions.js` / `duelStateMapper.js` |
| `db/` | `pool.js` (pool compartido de `pg`), `rooms.js`, `teamSelections.js`, `players.js`, `pokemons.js`, `reconciliation.js` |
| `migrations/` | SQL de node-pg-migrate (`0001`–`0005`) |
| `middleware/`, `lib/` | auth · rate limiting · manejador de errores · logger estructurado (`pino`) · sanitizadores |

---

## Arranque rápido (local)

### Backend

```bash
cd backend
npm install
cp .env.example .env          # después configurá DATABASE_URL a una instancia Postgres/Neon
npm run migrate:up
npm run seed                  # catálogo: 150 pokémon + matriz de tipos 18×18
npm run dev                   # escucha en PORT (default 3000)
```

### Frontend

```bash
cd frontend
npm install
# configurá VITE_API_URL (ej. http://localhost:3000/api) y VITE_WS_URL (ej. http://localhost:3000)
npm run dev
```

---

## Tests, lint, CI

| Comando | Paquete | Qué hace |
|---|---|---|
| `npm test` | frontend | Vitest — tests de componentes + unitarios (correr con `--maxWorkers=2` en máquinas con poca RAM) |
| `npm run build` | frontend | `tsc -b` + `vite build` |
| `npm run lint` | frontend | oxlint |
| `npm test` | backend | Vitest — ~330 tests corren sin `DATABASE_URL`; ~170 más están gateados por DB y necesitan una |
| `npm run lint` | backend | oxlint |
| `npm run migrate:up` / `migrate:down` | backend | node-pg-migrate |

**CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) corre ambos paquetes en cada
push y PR a `master`. Los tests del backend gateados por DB corren contra un **branch efímero
de Neon** creado y borrado en cada corrida; cuando faltan los secrets de Neon, ese bloque se
saltea de forma visible en el resumen del job, nunca se reporta como exitoso.

---

## Despliegue

- Push a `master` → **Vercel** redespliega `frontend/` automáticamente; **Render** redespliega `backend/`.
- Un cron pega a `GET /health` para mantener despierta la instancia gratuita de Render y evitar cold starts (ADR-0006).
- Las bases de dev y prod se mantienen separadas vía branching de Neon (ADR-0012); el bootstrap de tests rechaza correr operaciones destructivas salvo que `ALLOW_DESTRUCTIVE_DB_TESTS=1`.

---

## Cómo jugar

1. Ingresá un apodo → caés en el lobby.
2. Creá o unite a una sala (**1v1** = 2 lugares, **torneo** = 4 lugares). Podés agregar un bot para llenar un lugar.
3. Elegí **1 inicial exclusivo** (ningún otro jugador de la sala puede compartirlo) + **5 Pokémon** de plantel.
4. Marcate listo. Cuando todos los lugares están listos arranca el duelo; elegí tu Pokémon líder (30s de timer).
5. En cada turno (10s de timer) elegí uno de **4 movimientos** — 3 gastan PP (25 / 20 / 15 de daño), el movimiento 4 es ilimitado (10 de daño) — o cambiá de Pokémon. Las ventajas de tipo aplican un multiplicador ×2 / ×1 / ×0.5.
6. Noqueá a los seis Pokémon del rival para ganar. Una sala de 4 jugadores corre semifinales → final + tercer puesto y produce un ranking.

Reglas canónicas: [`spec-juego-tipo-pokemon.md`](spec-juego-tipo-pokemon.md).

---

## Documentación

| Archivo | Contenido |
|---|---|
| [`PRD.md`](PRD.md) | Requisitos de producto (RF / RNF) |
| [`TECH-DESIGN.md`](TECH-DESIGN.md) | Diseño técnico, modelo de datos, contratos de API, índice de ADRs |
| [`DESIGN.md`](DESIGN.md) | Overview de diseño de alto nivel |
| [`UX-DESIGN.md`](UX-DESIGN.md) | Diseño de UX / UI |
| [`spec-juego-tipo-pokemon.md`](spec-juego-tipo-pokemon.md) | Reglas del juego — matriz de tipos, daño, flujo de turnos |
| [`BACKLOG.md`](BACKLOG.md) | Backlog de implementación (todos los ítems completos) |
| [`DEPLOY-PLAN.md`](DEPLOY-PLAN.md) | Estrategia de despliegue |
| [`SECURITY-REPORT.md`](SECURITY-REPORT.md) | Revisión de seguridad |
| [`FIX-PLAN-production-bugs.md`](FIX-PLAN-production-bugs.md) | Análisis histórico de causa raíz de bugs tempranos en producción |
| [`adrs/`](adrs/) | Architecture Decision Records 0001–0012 |
| [`arquitectura/`](arquitectura/README.md) | Diagramas de arquitectura (modelo de clases, capas, C&C, despliegue) |

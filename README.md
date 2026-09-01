# PokeDuels

Real-time **1v1 and 4-player tournament Pokémon duels**. Pick an exclusive starter plus a
5-Pokémon roster, battle turn by turn using type advantages, and KO all six of your
rival's units to win. No levels, no items — pure type strategy. Identities are ephemeral
(just a nickname, no accounts).

- **Play:** <https://pokeduels.vercel.app>
- **API:** <https://pokeduels-backend.onrender.com>

**Status:** fully implemented and deployed. Product Fases 1–7 and Diagnostic Fases 1–6 are
merged to `master` — see [`BACKLOG.md`](BACKLOG.md) for the item-by-item history.

---

## Architecture at a glance

Monorepo with **two independent npm packages** and no root `package.json`.

| Piece | Stack | Runs on |
|---|---|---|
| `frontend/` | Vite 8 · React 19 · React Router 6 · Tailwind 4 · socket.io-client · **TypeScript** | Vercel (static SPA) |
| `backend/` | Express 5 (REST) · Socket.IO 4 (WS) · `pg` · node-pg-migrate · **plain JS (ESM)** | Render (one Node process) |
| Database | PostgreSQL — 10 tables, 5 migrations | Neon (serverless; ephemeral branch per CI run) |

- **The combat engine is server-authoritative.** `backend/engine/` is pure (no I/O): it
  resolves each round — order, damage, KO, end conditions — and the client only renders the
  snapshots it receives over WebSocket. The client never computes an outcome.
- **Duel phase state is not persisted.** `lead_selection` / `awaiting_actions` /
  `awaiting_switch` / `RESOLVING` live in server memory (`backend/ws/duelContext.js`, one
  store per connection); the client re-derives phase with `deriveDuelPhase()`.
- **Transport is hybrid:** REST for session / catalog / room creation, Socket.IO for
  everything live (`room:*`, `team:*`, `duel:*`).

Full diagrams — class model, layered view, component-and-connector, deployment — live in
[`arquitectura/`](arquitectura/README.md).

---

## Repository layout

```
.
├── frontend/                 React SPA            → see frontend/README.md
├── backend/                  Express + Socket.IO API + game engine
├── arquitectura/             Architecture diagrams (.drawio) + README
├── adrs/                     Architecture Decision Records (0001–0012)
├── Prototipos/               Original static HTML/CSS screen prototypes (design reference)
├── scripts/                  Repo tooling (sync-seed-data.mjs)
├── seed-data.json            Curated catalog seed (54 pokémon)
├── .github/workflows/ci.yml  CI: build + test + lint for both packages
└── *.md                      Project documentation (indexed below)
```

### `backend/` internals

| Folder | Responsibility |
|---|---|
| `app.js` / `server.js` | Express app factory · HTTP + Socket.IO bootstrap · graceful shutdown · startup reconciliation |
| `ws/` | WebSocket layer — `index.js` (composition root), `duelContext.js`, room/team/duel handlers, `turnCycle.js`, `tournamentLifecycle.js`, `botManager.js`, timer registries |
| `routes/` | REST — `session.js`, `rooms.js`, `catalog.js` |
| `engine/` | Pure game logic — `roundResolver.js`, `stateMachine.js`, `switchValidation.js`, `damageCalc.js`, `typeEffectiveness.js` |
| `repositories/` | Data access — `duelRepository.js` barrel over `duelQueries.js` / `duelTransactions.js` / `duelStateMapper.js` |
| `db/` | `pool.js` (shared `pg` pool), `rooms.js`, `teamSelections.js`, `players.js`, `pokemons.js`, `reconciliation.js` |
| `migrations/` | node-pg-migrate SQL (`0001`–`0005`) |
| `middleware/`, `lib/` | auth · rate limiting · error handler · structured logger (`pino`) · sanitizers |

---

## Quick start (local)

### Backend

```bash
cd backend
npm install
cp .env.example .env          # then set DATABASE_URL to a Postgres/Neon instance
npm run migrate:up
npm run seed                  # catalog: 54 pokémon + 18×18 type matrix
npm run dev                   # listens on PORT (default 3000)
```

### Frontend

```bash
cd frontend
npm install
# set VITE_API_URL (e.g. http://localhost:3000/api) and VITE_WS_URL (e.g. http://localhost:3000)
npm run dev
```

---

## Tests, lint, CI

| Command | Package | What |
|---|---|---|
| `npm test` | frontend | Vitest — component + unit tests (run with `--maxWorkers=2` on low-RAM machines) |
| `npm run build` | frontend | `tsc -b` + `vite build` |
| `npm run lint` | frontend | oxlint |
| `npm test` | backend | Vitest — ~275 tests run with no `DATABASE_URL`; ~164 more are DB-gated and need one |
| `npm run lint` | backend | oxlint |
| `npm run migrate:up` / `migrate:down` | backend | node-pg-migrate |

**CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs both packages on every push and PR to `master`. The DB-gated backend tests run against an **ephemeral Neon branch** created and deleted per run; when the Neon secrets are absent that block is skipped visibly in the job summary, never reported as passing.

---

## Deployment

- Push to `master` → **Vercel** redeploys `frontend/` automatically; **Render** redeploys `backend/`.
- A cron hits `GET /health` to keep the Render free-tier instance warm and dodge cold starts (ADR-0006).
- Dev and prod databases are kept separate via Neon branching (ADR-0012); the test bootstrap refuses to run destructive operations unless `ALLOW_DESTRUCTIVE_DB_TESTS=1`.

---

## How to play

1. Enter a nickname → land in the lobby.
2. Create or join a room (**1v1** = 2 seats, **tournament** = 4 seats). You can add a bot to fill a seat.
3. Pick **1 exclusive starter** (no two players in a room may share one) + **5 roster** Pokémon.
4. Ready up. When every seat is ready the duel starts; choose your lead Pokémon (30s timer).
5. Each turn (10s timer) pick one of **4 moves** — 3 cost PP (25 / 20 / 15 dmg), move 4 is unlimited (10 dmg) — or switch Pokémon. Type match-ups apply a ×2 / ×1 / ×0.5 multiplier.
6. KO all six of the opponent's Pokémon to win. A 4-player room runs semifinals → final + third-place and produces a ranking.

Canonical rules: [`spec-juego-tipo-pokemon.md`](spec-juego-tipo-pokemon.md).

---

## Documentation

| File | Contents |
|---|---|
| [`PRD.md`](PRD.md) | Product requirements (RF / RNF) |
| [`TECH-DESIGN.md`](TECH-DESIGN.md) | Technical design, data model, API contracts, ADR index |
| [`DESIGN.md`](DESIGN.md) | High-level design overview |
| [`UX-DESIGN.md`](UX-DESIGN.md) | UX / UI design |
| [`spec-juego-tipo-pokemon.md`](spec-juego-tipo-pokemon.md) | Game rules — type matrix, damage, turn flow |
| [`BACKLOG.md`](BACKLOG.md) | Implementation backlog (all items complete) |
| [`DEPLOY-PLAN.md`](DEPLOY-PLAN.md) | Deployment strategy |
| [`SECURITY-REPORT.md`](SECURITY-REPORT.md) | Security review |
| [`FIX-PLAN-production-bugs.md`](FIX-PLAN-production-bugs.md) | Historical root-cause analysis of early production bugs |
| [`adrs/`](adrs/) | Architecture Decision Records 0001–0012 |
| [`arquitectura/`](arquitectura/README.md) | Architecture diagrams (class model, layers, C&C, deployment) |

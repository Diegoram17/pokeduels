# PokeDuels

Real-time 1v1 and 4-player tournament Pokemon duels. Pick your squad, battle with type advantages, and climb the ranking. No levels, no items — pure type strategy.

**Status:** Implemented (Fases 1-7, see `BACKLOG.md`).

## Repository layout

Two independent npm packages, no root `package.json`:

| Package | Stack | Language |
|---|---|---|
| `frontend/` | Vite 8 + React 19 + React Router + Tailwind 4 + Socket.IO client | TypeScript |
| `backend/` | Express 5 + Socket.IO 4 + pg (Postgres/Neon) + node-pg-migrate | Plain JS (ESM) |

## Quick start

### Backend

```bash
cd backend
npm install
# Configure backend/.env with DATABASE_URL (Postgres/Neon)
npm run migrate:up
npm run seed
npm run dev
```

### Frontend

```bash
cd frontend
npm install
# Set VITE_API_URL and VITE_WS_URL env vars pointing to the backend
npm run dev
```

## Scripts

| Command | Where | What |
|---|---|---|
| `npm test` | frontend | Vitest run (component + unit tests) |
| `npm run lint` | frontend | oxlint |
| `npm run build` | frontend | tsc -b + vite build |
| `npm test` | backend | Vitest run (DB-gated tests require DATABASE_URL) |
| `npm run lint` | backend | oxlint |
| `npm run migrate:up` | backend | Run pending migrations |
| `npm run seed` | backend | Seed catalog (54 pokemon + 18x18 type matrix) |

## Live URLs

- Frontend: <https://pokeduels.vercel.app>
- Backend: <https://pokeduels-backend.onrender.com>

## Documentation

- `PRD.md` — Product requirements
- `TECH-DESIGN.md` — Technical design + architecture decisions
- `BACKLOG.md` — Implementation backlog (19 items, all complete)
- `adrs/` — Architecture Decision Records (0001-0012)
- `DEPLOY-PLAN.md` — Deployment strategy
- `spec-juego-tipo-pokemon.md` — Game rules specification

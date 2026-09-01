# PokeDuels — Frontend

Real-time Pokemon duels client. Vite + React 19 + TypeScript + Tailwind 4.

## Setup

```bash
npm install
```

## Environment variables

Create a `.env` file (or set in your shell):

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | Backend REST API base URL | `http://localhost:3000/api` |
| `VITE_WS_URL` | Backend WebSocket URL | `http://localhost:3000` |

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Start dev server (HMR) |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint (oxlint) |
| `npm run build` | Typecheck + production build |

## Architecture

- **Routes:** `src/routes/` — 7 screens (Login, Lobby, TeamSelect, WaitRoom, Duel, Swap, Ranking)
- **State:** `src/state/` — `MockStateProvider` (`useReducer` + Context, `reduceMockState`) + Socket.IO hooks (`useDuelSocket`, `useMockPersistence`)
- **Components:** `src/components/` — shared UI (Modal, ScreenTopbar, HpBar, etc.)
- **Design system:** `src/assets/pokeduels-design-system.css` (`.pd-*` tokens, Fase 7)
- **Engine:** combat is server-authoritative (`backend/engine/`); the client renders snapshots

See the [root README](../README.md) for the full project overview.

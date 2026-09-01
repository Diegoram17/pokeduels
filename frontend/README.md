# PokeDuels — Frontend

Cliente de duelos Pokémon en tiempo real. Vite + React 19 + TypeScript + Tailwind 4.

## Instalación

```bash
npm install
```

## Variables de entorno

Creá un archivo `.env` (o configuralas en tu shell):

| Variable | Descripción | Ejemplo |
|---|---|---|
| `VITE_API_URL` | URL base de la API REST del backend | `http://localhost:3000/api` |
| `VITE_WS_URL` | URL del WebSocket del backend | `http://localhost:3000` |

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta el servidor de dev (HMR) |
| `npm test` | Corre los tests (Vitest) |
| `npm run test:watch` | Corre los tests en modo watch |
| `npm run lint` | Lint (oxlint) |
| `npm run build` | Typecheck + build de producción |

## Arquitectura

- **Rutas:** `src/routes/` — 7 pantallas (Login, Lobby, TeamSelect, WaitRoom, Duel, Swap, Ranking)
- **Estado:** `src/state/` — `MockStateProvider` (`useReducer` + Context, `reduceMockState`) + hooks de Socket.IO (`useDuelSocket`, `useMockPersistence`)
- **Componentes:** `src/components/` — UI compartida (Modal, ScreenTopbar, HpBar, etc.)
- **Sistema de diseño:** `src/assets/pokeduels-design-system.css` (tokens `.pd-*`, Fase 7)
- **Motor:** el combate es autoritativo del servidor (`backend/engine/`); el cliente solo renderiza snapshots

Ver el [README de la raíz](../README.md) para el overview completo del proyecto.

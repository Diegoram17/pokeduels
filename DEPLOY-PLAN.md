# Deploy Plan — Pokeduels

Fecha: 2026-08-24
Estado: EJECUTADO (completo)

## Resumen del proyecto

Monorepo con `/frontend` (React 19 + Vite + Tailwind v4 + React Router + TS) y `/backend` (Node
ESM + Express 5 + Socket.IO 4 + `pg` + `node-pg-migrate`), ambos reales y con test suites verdes.
A diferencia de la versión anterior de este plan (2026-08-22, escrita cuando `/backend` no existía
todavía), hoy el backend está completo: REST + WebSocket + motor de duelo server-side + torneo de
bracket + resiliencia operativa (`/health` + reconciliación de arranque). Sigue sin existir remoto
de GitHub, CI/CD, Dockerfile, `vercel.json`/`render.yaml`, ni conexión real a Vercel/Render.

**Cambio de estado desde la versión anterior de este plan (2026-08-24):**

- `master` estaba 80 commits atrás de todo el trabajo de backend — se consolidó hoy (ver Registro
  de ejecución). `master` ahora tiene los 9 ítems del backlog completos, incluido `/health`, que
  vivía en una rama (`operational-resilience`) nunca mergeada.
- El backend aceptaba requests de cualquier origen (`cors()` sin restricción) y no soportaba
  `CORS_ORIGIN`. Se agregó soporte real (TDD) — ver Config & Secrets.
- El proyecto Neon ya sembrado con datos reales (ítem #1 del backlog) fue confirmado por el usuario
  como la base de **producción** — no se crea una Neon separada.

## Sistema de deployment propuesto

### Build

- **Frontend:** `tsc -b && vite build` → `frontend/dist/`. Sin cambios respecto al plan anterior,
  ahora confirmado real (`frontend/package.json`).
- **Backend:** sin build step — ESM plano (`"type": "module"`), se corre directo con
  `node server.js`. No hay nada que compilar.
- **Migraciones:** `node-pg-migrate`, 3 archivos en `backend/migrations/`, scripts `migrate:up`/
  `migrate:down` ya probados (incluye el fix `f4437be` — revierte la cadena completa en
  `migrate:down`).
- `poke-duel-engine/` (paquete legacy roto) sigue en el repo pero confirmado sin uso real en
  ningún lado — no participa del build. Limpieza pendiente, no bloquea deploy.

### Artifact

- **Frontend:** bundle estático (`dist/`), versionado por Vercel al commit SHA de cada deploy.
- **Backend:** Render construye directo del commit de `master` (buildpack Node nativo, sin
  Docker — mismo criterio del plan anterior: un solo dev, tier gratuito, sin necesidad de paridad
  de entorno entre plataformas).
- **DB:** las migraciones SQL versionadas en el repo son el artifact de schema — ya reales, no
  especulativas.

### Config & Secrets

- **Frontend (Vercel env vars):** `VITE_API_URL`, `VITE_WS_URL` — confirmados exactos en
  `frontend/src/lib/api.ts:14` y `frontend/src/lib/socket.ts:8`.
- **Backend (Render env vars):**
  - `DATABASE_URL` (secreto) — connection string de la Neon **ya existente**, confirmada como la
    de producción.
  - `PORT` — inyectada por Render automáticamente (`backend/server.js:8` ya la lee con fallback
    `?? 3000`).
  - `CORS_ORIGIN` — **implementado hoy** (`backend/app.js`, `backend/server.js`, TDD, 3 tests
    nuevos en `backend/test/cors.test.js`). Sin configurar, el backend sigue permisivo (`*`) para
    no romper dev/tests; en Render se setea a la URL de Vercel una vez que exista.
  - `NODE_ENV` — **no se lee en ningún lado del código actual**. No se configura por convención
    sin uso real; si en el futuro se agrega lógica que dependa de él, se documenta en ese momento.
- `.env.example` de backend actualizado con `CORS_ORIGIN` documentado. Ningún secreto en el repo.

### Infraestructura

- **Vercel** para `/frontend`.
- **Render**, Web Service único, instancia gratuita, para `/backend` — instancia única, sin HA,
  riesgo ya aceptado en ADR-0001.
- **Neon existente** (ya seedeada) como base de **producción** — decisión explícita del usuario
  (2026-08-24), no una Neon nueva separada.
  - **Riesgo a documentar:** al no haber separación dev/prod, cualquier prueba futura contra esa
    misma base afecta datos "de producción" directamente. Aceptado explícitamente, mismo patrón
    que el riesgo ya aceptado del token de sesión sin expiración (`SECURITY-REPORT.md`).
- **PokeAPI**, sin cambios — consumido directo desde el frontend, sin infraestructura propia.
- **Cron externo gratuito** (cron-job.org o UptimeRobot) contra `GET /health` — ahora sí es
  ejecutable: `/health` existe de verdad en `master` (antes no, ver Registro de ejecución).

### Entornos

- **Frontend:** Preview deployments automáticos de Vercel por cada push/PR, Production en `main`.
- **Backend:** un único entorno production (Render free tier no da preview sin costo); cambios se
  prueban localmente antes de mergear.
- **DB:** Neon ofrece branching gratuito, pero no se usa por ahora — la base actual ES la de
  producción, no hay un flujo dev/prod separado que branchear.

### Estrategia de release

- **Frontend:** deploy atómico nativo de Vercel, rollback a cualquier deploy anterior.
- **Backend: release directo** (Render reemplaza la instancia en cada deploy). Reafirmado por
  ADR-0001 (instancia única, sin HA) + ADR-0005 (estado de duelo en memoria) + ADR-0008
  (reconciliación de arranque, **ya real y confirmada en `master`**): todo redeploy tiene el mismo
  efecto que un crash, y el mecanismo de reconciliación ya probado deja duelos/rooms huérfanos en
  `aborted`/`finished(server_restart)` al reiniciar.

### Data & Migrations

- Ya reales, no especulativas: `node-pg-migrate`, 3 migraciones (`0001_initial-schema`,
  `0002_add-back-sprite`, `0003_add-walkover-end-reason`), corridas y probadas con tests.
- Rollback de código ≠ rollback de datos — cada migración necesita su `down`; migrar antes de
  deployar el código que la requiere, nunca al revés.

### Deploy gates

- **Frontend:** `tsc -b` (vía `npm run build`) + `vitest run` (198/198) + `oxlint` — corren en
  `.github/workflows/ci.yml` (generado hoy) en cada PR y push a `master`.
- **Backend:** `oxlint` (agregado hoy, `npm run lint`, 0 errores) + `vitest run`. **Decidido:** el
  CI le da al job de backend una Neon branch efímera real (`neondatabase/create-branch-action`),
  corre migraciones + seed contra ella, y ejecuta la suite completa (266 no-gated + 162 DB-gated)
  — no solo el subconjunto no-gated. La branch se borra al final del job (`if: always()`).
  Requiere `NEON_PROJECT_ID` y `NEON_API_KEY` como secrets del repo — se configuran en EXECUTE,
  cuando el proyecto Neon (ya usado como producción) se conecte al repo. Hasta entonces este paso
  del workflow falla al ejecutarse — esperado, no bloquea nada más.

### Verify & Observe

- **Backend:** `GET /health` — confirmado real en `master` hoy, responde 200 sin tocar la DB
  (antes de la consolidación de ramas de hoy, no existía en la rama activa). Post-deploy: pegarle
  y confirmar 200 — mismo endpoint que usa el cron de cold-start.
- **Frontend:** Vercel sirve el bundle, navegar rutas (`/`, `/lobby`, etc.) sin errores de consola.
- **DB:** verificar conexión del backend a Neon post-deploy (falla rápido si `DATABASE_URL` está
  mal configurada).
- **Observabilidad:** sin herramienta dedicada (RNF-4, un solo dev, tier gratuito) — logs nativos
  de Render/Vercel alcanzan para v1.

### Recovery

- **Frontend:** rollback nativo de Vercel a cualquier deploy previo.
- **Backend:** redeploy del commit anterior en Render.
- **Datos:** la reconciliación de arranque (ADR-0008, ya confirmada real en código) actúa como
  recovery automático ante cualquier reinicio/crash, incluido uno causado por un deploy fallido.
  Para revertir un schema, correr el `down` de la migración antes de revertir el código.
- **Incidente en Neon:** point-in-time restore / branching nativo del servicio.

## Autorizaciones pendientes

Ya hechos hoy (local, reversible, sin tocar ningún remoto ni cuenta externa):

1. ~~Consolidar el trabajo disperso en ramas hacia `master`~~ — **✅ HECHO** (fast-forward,
   `de8e417..58723b1`, ver Registro de ejecución).
2. ~~Fix `CORS_ORIGIN`~~ — **✅ HECHO** (TDD, commit `d7f6226`).
3. ~~Agregar lint al backend (`oxlint`)~~ — **✅ HECHO** (commit `b13de76`).
4. ~~Generar el workflow de CI~~ — **✅ HECHO** (`.github/workflows/ci.yml`, commit `9cd742f`).

Ejecutados en sesión de deploy (2026-08-24):

5. ~~Commitear `.github/workflows/ci.yml`~~ — **✅ HECHO** (commit `9cd742f`, junto con
   `.gitignore` actualizado con `.codegraph/` y `.vercel/`, `BACKLOG.md`, `DEPLOY-PLAN.md`,
   `SECURITY-REPORT.md`).
6. ~~Crear el repositorio remoto en GitHub y pushear `master`~~ — **✅ HECHO** (repo público
   `https://github.com/Diegoram17/pokeduels`, vía `gh repo create`).
7. ~~Conectar el repo a Vercel y disparar el primer deploy del frontend~~ — **✅ HECHO**
   (proyecto `pokeduels` en Vercel, URL: `https://pokeduels.vercel.app`).
8. ~~Activar el workflow de CI~~ — **⏳ PENDIENTE** — requiere configurar los secrets
   `NEON_PROJECT_ID` y `NEON_API_KEY` en el repo de GitHub.
9. ~~Crear el servicio en Render, conectar el repo, configurar env vars~~ — **✅ HECHO**
   (Web Service `pokeduels-backend`, URL: `https://pokeduels-backend.onrender.com`,
   `rootDir=backend`, env vars `DATABASE_URL` y `CORS_ORIGIN` configuradas).
10. ~~Volver a Vercel y actualizar `VITE_API_URL`/`VITE_WS_URL` con la URL real de Render~~ —
    **✅ HECHO** (frontend redeployado con URLs reales).
11. ~~Configurar el cron externo de health-check (cron-job.org/UptimeRobot) contra `/health`~~ —
    **✅ HECHO** — Monitor creado en UptimeRobot (ID: 803822718), intervalo 5 minutos,
    status: activo. Verificado: backend responde 200 OK en `/health`.

**Nota para quien ejecute esto:** el ítem #10 del backlog de producto (integración real de
duelo/torneo en el frontend — `WaitRoomScreen`/`DuelBoardScreen`/`SwapScreen`/`RankingScreen`)
sigue **pendiente**, sin relación con este plan de deploy. Quedó pausado en la fase `explore` del
ciclo SDD (`sdd/frontend-duel-tournament-integration/explore` en Engram, next recomendado:
`sdd-propose`). No es un prerequisito de deploy, pero el proyecto no está funcionalmente completo
hasta que se implemente.

## Registro de ejecución y verificación

### 2026-08-24 — Consolidación de ramas

- **Ejecutado:** `git checkout master && git merge --ff-only operational-resilience`.
- **Por qué era seguro:** `operational-resilience` había branchado exactamente desde la punta de
  `tournament-bracket-ranking/pr3-bracket` (que ya contenía los ítems #1-#7 y #9) y solo agregó 4
  commits propios — cero archivos tocados en ambos lados a la vez, fast-forward puro, conflicto
  imposible. Confirmado antes de ejecutar (`git merge-base`, diff de archivos por rama).
- **Resultado:** fast-forward limpio `de8e417..58723b1`, 148 archivos, sin conflictos.
- **Verificación:** backend 263/263 pass / 0 fail / 162 skip (DB-gated); frontend 198/198 pass.
- **Incidente:** el disco C: se llenó a 0 bytes libres durante la verificación posterior (ENOSPC en
  `npm`, y luego `git status` fallando al escribir `.git/index.lock`). El commit de merge ya
  estaba escrito en disco antes del fallo — sin pérdida de datos. El usuario liberó espacio
  (614 MB libres al retomar) y se confirmó la integridad del repo antes de seguir.

### 2026-08-24 — Fix `CORS_ORIGIN` (TDD)

- Test rojo (`backend/test/cors.test.js`, 2/3 fallando) → implementación en `backend/app.js`
  (`cors({ origin: process.env.CORS_ORIGIN || '*' })`) y `backend/server.js`
  (`createSocketServer(httpServer, { corsOrigin: process.env.CORS_ORIGIN })` — el parámetro ya
  existía en `backend/ws/index.js`, solo faltaba conectarlo) → verde.
- Un test tuvo que corregirse en el camino: `cors` con un string estático siempre refleja ese
  valor tal cual (no compara contra el `Origin` real del request) — la validación real la hace el
  browser, no el server. El test se ajustó para probar lo correcto: que el header nunca vuelve a
  ser `*` una vez configurado `CORS_ORIGIN`.
- `backend/.env.example` actualizado documentando la variable.
- Suite completa: 266/266 pass, 0 fail, 162 skip (mismo baseline DB-gated de antes).
- Commit `d7f6226`.

### 2026-08-24 — Lint de backend + CI (GENERATE)

- `oxlint` agregado a `backend/` (mismo criterio que el frontend, plugin `oxc` únicamente — sin
  `react`/`typescript`, el backend es JS ESM plano). `npm run lint` corre limpio hoy (solo
  warnings preexistentes de variables sin usar en tests, ningún error). Commit `b13de76`.
- Generado `.github/workflows/ci.yml`: job `frontend` (build + test + lint) y job `backend`
  (lint + Neon branch efímera vía `neondatabase/create-branch-action@v6` + migraciones + seed +
  suite completa + borrado de la branch al final). Nombres/inputs de las actions de Neon
  verificados contra su documentación (no asumidos). Sin commitear todavía — queda como parte de
  EXECUTE, junto con la configuración de los secrets `NEON_PROJECT_ID`/`NEON_API_KEY` que el
  workflow necesita para poder correr de verdad.
- **A partir de acá, esta sesión no ejecuta nada más** — el resto de "Autorizaciones pendientes"
   (crear remoto, conectar Vercel/Render, activar CI, cron) lo ejecuta otra sesión/agente, paso a
   paso, con autorización explícita en cada uno.

### 2026-08-24 — Deploy completo (EXECUTE)

**Scan de seguridad pre-commit:**
- Barrido de secrets en archivos a commitear: limpio (sin credenciales en `.md`, `.yml`, `.json`).
- `backend/.env` con connection string real de Neon confirmado como NO trackeado (`.gitignore` línea 10).
- `.gitignore` actualizado: agregados `.codegraph/` y `.vercel/` (PART3-01 del SECURITY-REPORT).
- Commit `9cd742f`: CI workflow + documentación + `.gitignore` actualizado.

**GitHub:**
- Repo creado: `https://github.com/Diegoram17/pokeduels` (público).
- `master` pusheado vía `gh repo create --push`.

**Vercel (frontend):**
- Proyecto creado: `pokeduels` (org `diegoram17-7684s-projects`).
- Primer deploy: `https://pokeduels.vercel.app` (con placeholders en env vars).
- Env vars configuradas: `VITE_API_URL`, `VITE_WS_URL` (visibility: config, non-sensitive).
- Redeploy final con URLs reales de Render.

**Render (backend):**
- Web Service creado: `pokeduels-backend` (ID: `srv-da6c6rnavr4c73en1gb0`).
- URL: `https://pokeduels-backend.onrender.com`.
- Dashboard: `https://dashboard.render.com/web/srv-da6c6rnavr4c73en1gb0`.
- Configuración: `runtime=node`, `rootDir=backend`, `plan=free`, `region=oregon`.
- Build command: `npm install`, Start command: `node server.js`.
- Env vars: `DATABASE_URL` (Neon existente), `CORS_ORIGIN=https://pokeduels.vercel.app`.
- Deploy `dep-da6c7c6k1f9s73fdrhc0` → status: `live`.
- Verificación: `GET /health` → 200 OK.

**Pendiente:**
- CI secrets (`NEON_PROJECT_ID`, `NEON_API_KEY`) — configurar en GitHub repo settings.

**UptimeRobot (health-check):**
- Monitor creado: `pokeduels-backend-health` (ID: 803822718).
- URL: `https://pokeduels-backend.onrender.com/health`.
- Intervalo: 300 segundos (5 minutos).
- Status: activo (status code 1).
- Verificación: `GET /health` → 200 OK.
- Propósito: mantener el backend de Render despierto (evitar cold start del free tier).

### 2026-08-25 — Fix de 4 bugs reportados en producción (sala de espera / torneo 4 jugadores) + deploy

**Cambio:** solo `frontend/` (7 archivos, sin migraciones, sin cambios de infra/secrets):
1. `BotManager` (WaitRoomScreen.tsx) agregaba todos los slots vacíos de una — ahora agrega 1 bot
   por click.
2. Se eliminó el botón duplicado "Iniciar Partida"; `PlayerRow` ahora refleja el campo `ready`
   real de cada jugador (antes dependía de `isBot`).
3. `MockStateProvider` normaliza `playerId` a string en `room:state` y `sessionEstablished` (el
   backend lo serializa como número de Postgres) — el cuadro de llaves resolvía ids crudos en vez
   de nicknames por una comparación `===` string-vs-number.
4. `EnterDuelButton` ya no navega a `/duel` antes de que llegue `duel:state` — eliminado el race
   condition que rebotaba al jugador a la sala de espera sin entrar al duelo.

**Verificación pre-deploy:** diff revisado línea por línea contra el plan original, frontend
248/248 tests OK, `tsc -b` sin errores, `oxlint` sin errores. Commit `53caf44` (conventional
commit, sin cambios en `backend/`).

**Deploy gate saltado (conocido, documentado arriba):** el workflow de CI (`ci.yml`) sigue sin
poder correr el job de `backend` — `NEON_PROJECT_ID`/`NEON_API_KEY` todavía no están configurados
como secrets del repo (ítem #8 de "Autorizaciones pendientes", sin cambios desde 2026-08-24). El
job de `frontend` si corre. No bloqueó este deploy porque el cambio no toca `backend/`.

**Incidente durante el deploy — build cache de Vercel corrupta:**
- `git push origin master` (commit `53caf44`) disparó el deploy automático de Vercel — **falló**:
  `sh: line 1: vite: command not found` / `Command "vite build" exited with 127`, inmediatamente
  después de `Restored build cache from previous deployment` (sin paso de install visible antes).
- Antes de asumir que el cambio lo causó, se verificó el deploy del commit **anterior** (`c1f3399`,
  2026-08-25 17:25, sin relación con este fix) vía
  `gh api repos/.../deployments/.../statuses` + `vercel inspect <id> --logs`: **mismo error
  exacto**. Confirmado: cache de build corrupta/flaky en el proyecto de Vercel, preexistente,
  no causada por este commit.
- **Remediación:** `vercel deploy --prod --force --yes` desde `frontend/` (proyecto ya linkeado
  vía `.vercel/project.json`) — `--force` sin `--with-cache` descarta la cache corrupta y fuerza
  `npm install` real. Build limpio (`72 modules transformed`, `built in 307ms`), deploy `READY`,
  aliaseado a `https://pokeduels.vercel.app`.
- **Verificación post-deploy:** `GET https://pokeduels.vercel.app/` → 200, sirviendo
  `index-q7gD4FQZ.js` (hash del build recién generado, confirma que el alias apunta al deploy
  nuevo). `GET https://pokeduels-backend.onrender.com/health` → 200 (backend no tocado, sigue
  sano).
- **Nota para el próximo deploy:** si vuelve a aparecer `vite: command not found` /
  `command not found` después de `Restored build cache`, es este mismo problema — reintentar con
  `vercel deploy --prod --force --yes` (sin `--with-cache`) en vez de re-diagnosticar desde cero.
  No se investigó la causa raíz del lado de Vercel (fuera del control del proyecto); si se repite
  seguido, vale la pena abrir un ticket de soporte con Vercel adjuntando los `inspectorUrl` de los
  deploys fallidos.

**Confirmado recurrente, no fue un evento único:** el siguiente push a `master` (commit `9f29c3b`,
solo este mismo `DEPLOY-PLAN.md`, sin tocar `frontend/`) disparó el deploy automático de Vercel de
nuevo — **falló otra vez**, firma idéntica (`Restored build cache from previous deployment
(A1erYcoNN5wfHrn41pAUq2kvxCPd)` → `vite: command not found`, sin paso de install visible), a pesar
de que ese ID de cache (`A1erYcoNN5wfHrn41pAUq2kvxCPd`) es exactamente el deploy exitoso anterior.
Es decir: **todo deploy disparado por push normal (que restaura cache) falla; solo un
`--force` (que descarta cache) funciona.** La alias de producción NO se movió (Vercel no
re-aliasea en un deploy fallido), así que `https://pokeduels.vercel.app` siguió sirviendo el build
bueno (`index-q7gD4FQZ.js`) sin interrupción — pero el pipeline de auto-deploy en sí está roto de
forma consistente hasta que alguien decida cómo resolverlo (deshabilitar la build cache del
proyecto en Vercel, u otra causa raíz por investigar). Esto queda reportado al usuario, no resuelto
unilateralmente — es un cambio de configuración de infraestructura, fuera del alcance ya
autorizado de "pushear y deployar este fix".

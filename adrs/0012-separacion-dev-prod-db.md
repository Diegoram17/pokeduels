# ADR 0012: Separación dev/prod de base de datos vía Neon branching

## Estado

Aceptado

## Contexto

El 2026-08-24 se tomó la decisión de usar una **única Neon** (la ya seedeada) como
base de producción y no crear una Neon separada para desarrollo (registrada en
`DEPLOY-PLAN.md` §Infraestructura como "Neon existente (ya seedeada) como base de
producción"). La consecuencia quedó documentada como **riesgo aceptado**: "al no
haber separación dev/prod, cualquier prueba futura contra esa misma base afecta
datos 'de producción' directamente".

Ese riesgo se materializó el 2026-08-25: una corrida local de `npm test` en
`backend/` contra el `DATABASE_URL` de `.env` (la Neon de producción) ejecutó la
suite de integración completa, incluido `migrate down 0` (borrado total del schema),
dejando la base de producción momentáneamente vacía hasta que un re-seed la
reconstruyó (incidente registrado en `DEPLOY-PLAN.md`, nota 2026-08-25).

El problema estructural: `backend/.env` apunta a producción, las suites DB-gated
corren contra `DATABASE_URL` sin distinguir el destino, y `backend/test/helpers.js`
provisiona schema + seed de forma destructiva cuando los datos no están presentes.

## Decisión

**Reversar la decisión del 2026-08-24:** se adopta la separación dev/prod mediante
**Neon branching**, con un branch `dev` dedicado para el trabajo local:

- El desarrollador crea un branch `dev` en la consola de Neon (desde `main`, con
  los datos ya seedeados) y apunta `backend/.env` → `DATABASE_URL` a ese branch.
- La Neon de **producción (`main`) nunca se usa para corridas de test locales**:
  ni migraciones, ni seed, ni `migrate down`.
- Un guard destructivo (`assertDestructiveDbAllowed()` en `backend/test/helpers.js`)
  bloquea `migrate down` y re-seed salvo que `ALLOW_DESTRUCTIVE_DB_TESTS=1` esté
  seteado — la señal primaria de que el destino es descartable. CI setea el flag en
  sus pasos DB-gated contra branches efímeras (creadas y borradas por job).

Detalle operativo: los hostnames de Neon (`ep-...neon.tech`) llevan un id aleatorio,
no el nombre del branch, así que el host no distingue dev de prod; por eso la señal
primaria del guard es el flag, no el host.

## Alternativas consideradas

- **Mantener Neon única y "tener cuidado"** (decisión 2026-08-24) — rechazada: el
  incidente del 2026-08-25 demostró que "tener cuidado" no alcanza; la suite es
  destructiva por diseño y un solo `npm test` local la dispara.
- **Postgres local / Docker para desarrollo** — rechazada: el proyecto es Neon-only
  (sin Postgres local, convención documentada en `backend/.env.example`); agregar
  Docker rompe la paridad de entorno y RNF-4 (tiers gratuitos).
- **Separar por `DIRECT_URL` / pooler** — rechazada: `DATABASE_URL` ya es el
  endpoint directo; el problema no es el endpoint sino **qué base** recibe las
  operaciones destructivas.
- **Guard por hostname denylist** (`PROD_DB_HOST_MARKERS`) — considerada: un
  denylist de substrings del host de producción reforzaría el flag, pero los
  hostnames `ep-` de Neon no exponen el nombre del branch y commitear un substring
  del host de producción es frágil; se entrega vacío con comentario y el guard
  confía en el flag.

## Consecuencias

- Toda corrida DB-gated **local** requiere: branch `dev` de Neon + `.env` apuntando
  a él + `ALLOW_DESTRUCTIVE_DB_TESTS=1`. Sin el flag, el bootstrap de tests falla
  con un mensaje de remediación que nombra exactamente esos tres pasos.
- CI queda intacta: sus pasos DB-gated ya crean branches efímeras por run y setean
  el flag, por lo que el guard no afecta el pipeline.
- `DEPLOY-PLAN.md` §Infraestructura/§Entornos pasa de "riesgo aceptado" a
  "MITIGADO" (2026-08-31, ítem #17 del backlog) con referencia a este ADR y al
  guard.
- La creación del branch `dev` en Neon es una acción del usuario en la consola de
  Neon (no automatizable desde este repo sin secrets adicionales).
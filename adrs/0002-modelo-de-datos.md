# ADR 0002: Modelo de datos

## Estado

Aceptado

## Contexto

El PRD (RF-1 a RF-7, RF-5.5) exige persistir: identidades efímeras por nickname (RF-1), salas con
código corto y capacidad 2/4 (RF-2), equipos draftados con exclusividad de inicial (RF-3), el
estado vivo de cada duelo — HP, PP, pokémon activo, K.O. — con cálculo autoritativo en servidor
(RF-4, RNF-3), el resultado y ranking por torneo sin persistencia entre sesiones (RF-5, RF-1.5), y
ahora también rendición voluntaria (RF-5.5). Los prototipos HTML (`Prototipos/`) confirmaron
además campos concretos: código de sala corto, contador de progreso del draft, estado de sala
(`waiting`/`in_progress`), posición final por jugador — y de paso revelaron un sistema de
rango/estadísticas persistentes (Diamante IV, Victorias, Puntuación) que **no** corresponde
implementar: el usuario confirmó que son restos de un template sin adaptar y deben ignorarse,
coherente con "No alcance" del PRD (sin ranking global ni cuentas persistentes).

## Decisión

Schema relacional normalizado en PostgreSQL (Neon), tal como ya estaba borradeado en
`TECH-DESIGN.md` §3: `players`, `pokemons`, `type_effectiveness`, `rooms`, `room_players`,
`team_selections`, `duels`, `duel_pokemon_state`, `moves`. El estado vivo de cada pokémon durante
un duelo (`current_hp`, `pp_move_1/2/3`, `is_active`, `fainted`) vive en la tabla
`duel_pokemon_state`, una fila por pokémon por duelo, no en un blob JSON. El ranking de torneo
(`final_rank`) vive en `room_players`, acotado a esa sala — no existe ninguna tabla de
rango/estadísticas persistente entre sesiones. `duels.end_reason` admite `ko | disconnect |
surrender`.

## Alternativas consideradas

- **Blob JSONB** (`duels.state JSONB` con todo el estado del duelo embebido) — permite iterar el
  schema sin migraciones durante el desarrollo, pero pierde las validaciones de la BD (`CHECK`,
  `FOREIGN KEY`) que hoy garantizan, por ejemplo, que `current_hp` no sea negativo o que no haya un
  pokémon duplicado en el mismo duelo. Las queries de "¿quién sigue con vida?" (necesarias para
  RF-5.1) también se vuelven más lentas/difíciles sobre JSON que sobre columnas tipadas. Rechazada:
  RNF-3 (autoridad del servidor) se apoya mejor en constraints de BD que en validación manual sobre
  un blob.
- **Sistema de rango/estadísticas persistente** (sugerido por los prototipos) — rechazada porque
  contradice directamente "No alcance" del PRD (ranking global/ELO, cuentas persistentes) y
  RF-1.5 (sin persistencia de identidad entre sesiones).

## Consecuencias

- Los constraints de BD (`UNIQUE (room_id, nickname)`, `uq_starter_por_sala`,
  `CHECK (max_players IN (2,4))`) hacen que varias reglas del PRD (RF-1.4, RF-3.2, RF-2.1) se
  cumplan a nivel de dato, no solo de código de aplicación — menos superficie para bugs de
  concurrencia (ej. condición de carrera al elegir inicial).
- Trade-off real: cualquier cambio de forma en el estado del duelo (agregar un campo nuevo a
  `duel_pokemon_state`) requiere una migración de schema, más lento de iterar que agregar una
  clave a un JSON durante el desarrollo temprano. Aceptado porque el modelo de combate ya está
  bien definido y estable en el PRD — no se esperan cambios frecuentes de forma.

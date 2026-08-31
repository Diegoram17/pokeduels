# ADR 0010: Revancha en duelos 1v1

## Estado

Aceptado

## Contexto

Al terminar un duelo 1v1 (`duels.status='finished'`), la sala sigue existiendo y los
dos jugadores siguen sentados en ella. El sistema de rematches se implementó sin
documentar su contrato: `advanceTournamentOrRematch` (`backend/ws/tournamentLifecycle.js`)
tiene una rama dedicada a salas `max_players = 2` que se dispara después de cada
duelo finalizado.

El comportamiento real, verificado en `backend/ws/tournamentLifecycle.js:147-154`:

1. Se toma el lock `FOR UPDATE` de la fila de la sala (ADR-0005).
2. Se resetea `room_players.ready = FALSE` para **ambos** asientos (`UPDATE room_players
   SET ready = FALSE WHERE room_id = $1`).
3. La sala **permanece** `in_progress` — no se cierra, no se rankea, no se emite
   `room:final_ranking` ni ningún evento de torneo.
4. La revancha es un **opt-in explícito**: cada jugador debe volver a confirmar
   `ready` vía `room:ready`, y cuando ambos están listos `bootstrapDuelIfReady`
   crea un duelo nuevo.

La idempotencia de creación de duelo (`createDuelFromRoom`) está acotada a
`status IN ('pending','in_progress')`, por lo que un duelo ya `finished` nunca
bloquea la creación del siguiente: el rematch genera una fila nueva en `duels`.

## Decisión

Documentar y mantener el mecanismo de revancha 1v1 tal como está implementado:

- **Revancha manual, nunca automática:** un duelo terminado no arranca otro
  inmediatamente; ambos jugadores deben re-confirmar `ready`.
- **La sala no se cierra entre duelos:** el estado `in_progress` se conserva y el
  ciclo `room:ready` → `bootstrapDuelIfReady` es el único camino para crear el
  duelo siguiente.
- **Sin evento de cierre/ranking por duelo:** `room:final_ranking` y el cierre de
  sala son responsabilidad de `leaveOrCloseRoom` (ítem #7, PR 2), no de la
  finalización de un duelo individual.

## Alternativas consideradas

- **Revancha automática inmediata** — rechazada: un rematch forzado sin opt-in
  sorprendería a un jugador que quiere cambiar de equipo o salir; el opt-in
  explícito (re-ready) es el patrón que ya usaba el lobby y no agrega estado nuevo.
- **Cerrar y recrear la sala en cada duelo** — rechazada: destruir la sala
  perdería los asientos, el equipo seleccionado y el contexto del canal Socket.IO;
  además chocaría con el modelo de `leaveOrCloseRoom`.
- **Rastrear un contador de duelos por sala** — rechazada: la idempotencia de
  `createDuelFromRoom` ya resuelve la creación del duelo siguiente sin estado
  extra; un contador agregaría un campo sin uso real.

## Consecuencias

- El frontend debe presentar la revancha como un opt-in (botón de re-ready) y no
  asumir que un duelo terminado reinicia solo.
- Un jugador que abandona después de un duelo (leave o disconnect con grace)
  sale por el camino de `leaveOrCloseRoom`/reconnect, no por el rematch.
- Este ADR fija el contrato para que un futuro refactor (p. ej., fase 3
  `DuelContext`) preserve el reset de `ready` y la permanencia de
  `in_progress` sin cambios de comportamiento.
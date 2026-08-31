# ADR 0011: `end_reason='walkover'` para duelos de bracket no iniciados

## Estado

Aceptado

## Contexto

En el torneo de 4 jugadores, un jugador que se desconecta **entre rondas** (su
duelo de bracket ya fue creado pero nunca arrancó, `status='pending'`) no puede
perderse por forfeit de `disconnect` (que exige `in_progress`). Se necesita un
motivo de fin distinto que la reconciliación (ADR-0008) pueda distinguir: un duelo
`pending` terminado por ausencia es un **walkover** (derrota por timeout), no un
abandono a mitad de duelo.

La migración `0003_add-walkover-end-reason.sql` amplió el CHECK
`duels_end_reason_check` a `('ko','disconnect','surrender','server_restart','walkover')`.

El mecanismo verificado en código:

- `finishDuelByWalkover` (`backend/repositories/duelRepository.js:164-171`) ejecuta
  `UPDATE duels SET status='finished', winner_id=$2, end_reason='walkover'
   WHERE id=$1 AND status IN ('pending','in_progress')` — el guard
  `status IN ('pending','in_progress')` hace que un walkover repetido o que corre
  contra otro finish sea un no-op silencioso (`applied:false`).
- El timer se arma desde `backend/ws/roomHandlers.js:193-200` (disconnect entre
  rondas con duelo `pending` pendiente) y desde
  `armWalkoversForDisconnected` (`backend/ws/tournamentLifecycle.js:74-86`, gap
  "el duelo aún no existe").
- Una reconexión dentro de la gracia (`room:join` → `bracketWalkoverTimers.cancel`)
  cancela el timer y el duelo no se da por perdido.

## Decisión

Documentar y mantener `walkover` como motivo de fin **distinto de `disconnect`**:

- `disconnect`: forfeit inmediato de un duelo `in_progress` (el rival gana y el
  duelo estaba en curso).
- `walkover`: derrota por timeout de un duelo `pending` que nunca arrancó (ausencia
  entre rondas del bracket); también aplica a `in_progress` por diseño del UPDATE,
  pero su caso canónico es el `pending`.

La distinción es necesaria para que la reconciliación de arranque y el avance del
bracket (`advanceTournamentOrRematch`) puedan razonar sobre duelos que se
resolvieron por ausencia sin confundirlos con abandono a mitad de partida.

## Alternativas consideradas

- **Reusar `disconnect` para el walkover** — rechazada: `disconnect` describe un
  forfeit mid-duel; un duelo `pending` que nunca empezó no puede "desconectarse"
  de algo que no estaba en curso, y la reconciliación necesita distinguir ambos
  casos (ADR-0008).
- **Borrar el duelo `pending` del jugador ausente** — rechazada: eliminar la fila
  perdería el registro auditado del resultado y complicaría el avance del bracket
  (el duelo debe existir para rankear al perdedor).
- **Un CHECK de base de datos separado por tabla de walkovers** — rechazada: un
  valor más en el CHECK existente es suficiente; una tabla nueva sería
  sobredimensionada para v1.

## Consecuencias

- `duels.end_reason` admite cinco valores; cualquier UI/analítica debe tratar
  `walkover` como derrota por ausencia, no como abandono.
- El `down` de la migración 0003 restaura el CHECK sin `walkover`, por lo que un
  rollback de schema requiere que no existan filas con ese valor (los tests de
  integración truncan antes de `migrate down 0`).
- El valor queda fijado como contrato público del schema; futuros refactors del
  bracket deben conservar el guard `status IN ('pending','in_progress')` de
  `finishDuelByWalkover`.
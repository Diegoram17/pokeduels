# ADR 0008: Reconciliación de duelos y torneos huérfanos tras reinicio del backend

## Estado

Aceptado

## Contexto

La revisión adversarial de TECH-DESIGN.md (skill `revision-adversarial`, ejecutada en un agente
sin contexto previo) encontró un error real en ADR-0005: el documento afirmaba que si el backend
se reinicia a mitad de un duelo, "los jugadores lo perciben igual que una desconexión del rival"
(RF-6.2). Eso es incorrecto — `duel:opponent_disconnected` lo emite un proceso **vivo** que
detecta la caída del socket del rival. Si el proceso entero muere, no hay nadie que emita ese
evento: ambos jugadores pierden conexión simultáneamente y, como no hay reconexión mid-duelo
(TECH-DESIGN §10, ítem 2), nada cierra `duels.status='in_progress'` ni asigna `winner_id`. En un
torneo de 4, eso bloquea el bracket permanentemente (contradice RF-5.4). Como el backend es
instancia única (ADR-0001), un crash afecta simultáneamente a todas las salas activas del
servidor, no solo a un duelo aislado.

## Decisión

Al arrancar, el backend ejecuta una **reconciliación de arranque**: busca todos los `duels` con
`status='in_progress'` (imposibles de tener contraparte viva en memoria tras un reinicio del
proceso) y los marca `status='finished'`, `end_reason='server_restart'`, `winner_id=NULL`. La
`room` asociada a cada uno pasa a un estado nuevo, `status='aborted'`, distinto de `'finished'`
(que implica un ranking real) — el torneo completo de esa sala se anula, no solo el duelo
huérfano, porque no hay forma justa de completar un bracket con un resultado faltante. Cuando un
jugador reconecta (Socket.IO auto-reconnect + `sessionStorage`, mismo mecanismo de RF-2.7) a una
sala `aborted`, el servidor emite `room:aborted` con un motivo; el cliente muestra un mensaje y
vuelve a P2 (lobby).

## Alternativas consideradas

- **Intentar retomar desde el último estado persistido** en `duel_pokemon_state`/`moves` (los
  `UPDATE`/`INSERT` asíncronos que sí llegaron a Postgres antes del crash) — más amigable para el
  jugador, pero reintroduce reconexión mid-duelo, una decisión ya tomada en contra (TECH-DESIGN
  §10, ítem 2). Además no hay garantía de que el último estado persistido coincida con lo que los
  clientes tenían en memoria justo antes del crash, dado que la persistencia es best-effort
  (ADR-0005) — la reconstrucción podría ser inconsistente entre jugadores. Rechazada: complejidad
  real para un caso que debería ser poco frecuente en un backend de instancia única bien operado.

## Consecuencias

- Cierra el hallazgo crítico de la revisión adversarial: ya no quedan duelos/salas en un estado
  `in_progress` indefinido tras un reinicio del backend.
- Comportamiento determinista y simple de implementar: una query de arranque, un nuevo estado de
  `rooms`, un evento WS nuevo.
- Trade-off real: un torneo de 4 jugadores donde uno de los dos duelos ya había terminado se anula
  igual que uno recién empezado — el jugador que ya ganó su duelo pierde ese resultado y debe
  volver a jugar todo el torneo desde cero. Aceptado porque preservar el resultado parcial
  exigiría la reconstrucción desde estado persistido que se rechazó arriba.

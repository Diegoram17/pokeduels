# ADR 0005: Manejo de estado

## Estado

Aceptado

## Contexto

RNF-1 exige < 500ms percibidos en la resolución de cada turno. RNF-6 ya acepta el cold start de
Render, y Neon (Postgres serverless) puede sumar latencia de conexión/query encima de eso. RF-4.12
exige que el cálculo de combate sea autoritativo en servidor. La tabla `duel_pokemon_state`
(ADR-0002) y el log `moves` existen para persistencia y auditoría, pero no estaba resuelto si cada
acción del duelo escribe en Postgres de forma síncrona antes de confirmar al cliente, o si el
backend mantiene su propio estado en memoria.

## Decisión

Esta decisión aplica **solo al estado de un duelo en curso**, no a las operaciones de sala/lobby.

- **Estado de duelo (in-memory + async):** el backend mantiene el **estado activo de cada duelo en
  memoria** (autoritativo mientras el duelo está en curso) y lo persiste a Postgres de forma
  **asíncrona** (best-effort, sin bloquear la respuesta al cliente) hacia `duel_pokemon_state` y el
  log `moves`. La resolución de una ronda (`resolverRonda`, TECH-DESIGN §4.4) opera sobre el estado
  en memoria y emite `duel:turn_resolved` sin esperar al `INSERT`/`UPDATE` en BD.
- **Operaciones de sala/draft (síncronas contra Postgres):** `room:join`, `room:ready`,
  `team:select_starter`, `team:select_roster` y `room:leave` sí esperan la confirmación de Postgres
  antes de responder al cliente. Esto no es una inconsistencia con lo anterior — es necesario:
  RF-3.2 (exclusividad del starter) depende de que `uq_starter_por_sala` (ADR-0002) rechace la
  segunda escritura concurrente *antes* de que el servidor confirme la reserva a ningún cliente. Si
  esa escritura fuera memoria-primero, dos jugadores podrían ver ambos "confirmado" antes de que la
  colisión se detecte.

## Alternativas consideradas

- **Postgres síncrono como fuente de verdad** — cada acción hace `UPDATE`/`INSERT` antes de
  confirmar al cliente. Un solo lugar de verdad, sin duplicar estado entre memoria y BD, pero cada
  turno paga latencia de red + query a Neon — riesgo directo sobre RNF-1, agravado por el cold
  start ya aceptado en RNF-6. Rechazada por ese motivo.

## Consecuencias

- La resolución de turno no depende de la latencia de Neon, lo que da el mejor margen posible para
  cumplir RNF-1.
- Trade-off real: si el proceso backend se reinicia o cae a mitad de un duelo, el estado en
  memoria de ese duelo se pierde. A diferencia de una desconexión individual (RF-6.2, detectada
  por un proceso vivo), un crash del proceso entero no tiene quién declare al rival ganador —
  deja el duelo en un estado indefinido hasta que actúa la reconciliación de arranque (ADR-0008),
  que lo anula explícitamente junto con el resto del torneo de esa sala. Este riesgo de
  disponibilidad ya estaba aceptado en ADR-0001 (backend de instancia única, sin alta
  disponibilidad en v1); ADR-0008 resuelve la consecuencia concreta sobre datos huérfanos, no la
  causa raíz (seguir sin HA en v1).
- **Limpieza de memoria:** dado que ADR-0006 mantiene el proceso corriendo 24/7 (health check
  periódico evita que Render lo duerma), el estado en memoria de salas/duelos debe evictarse al
  llegar a un estado terminal — `rooms.status IN ('finished','aborted')` — inmediatamente después
  de emitir `room:final_ranking` o `room:aborted`, no acumularse indefinidamente. Sin esto, un
  proceso de larga vida con muchas partidas jugadas arriesga un crecimiento de memoria no acotado
  en un tier gratuito con RAM limitada.

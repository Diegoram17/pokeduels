# ADR 0006: Resiliencia — mitigación del cold start de Render

## Estado

Aceptado

## Contexto

RNF-6 acepta el cold start de Render en tier gratuito, pero el PRD deja la mitigación abierta
("Health check periódico o aceptar el delay inicial en v1") en su tabla de riesgos. El cold start
de un servicio dormido puede tardar decenas de segundos, lo que puede romper el criterio de éxito
"Tiempo de onboarding (nickname → primer ataque) < 2 minutos" si un jugador nuevo llega justo
cuando la instancia está dormida.

## Decisión

Implementar un **health check periódico externo**: un servicio de cron gratuito dedicado a este
caso de uso (ej. cron-job.org o UptimeRobot, tier free) hace `GET` cada 10-14 minutos a un
endpoint `/health` del backend para mantenerlo despierto durante el horario esperado de uso.

## Alternativas consideradas

- **Aceptar el cold start sin mitigación**, mostrando un estado de carga claro ("Conectando al
  servidor...") en el frontend mientras Render despierta — cero infraestructura extra, pero deja
  el criterio de éxito de onboarding a merced de en qué momento llega cada jugador nuevo. Rechazada
  porque el costo de la mitigación (un cron gratuito) es casi nulo comparado con el riesgo real
  sobre una métrica de éxito ya comprometida en el PRD.
- **GitHub Actions `schedule`** — fue la elección original de esta ADR, pero la revisión
  adversarial (skill `revision-adversarial`) encontró que GitHub **desactiva automáticamente los
  workflows programados tras 60 días sin actividad en el repositorio**. Para un solo desarrollador
  que puede pausar el proyecto, es un escenario plausible, y la desactivación es silenciosa — el
  cron dejaría de correr sin ningún aviso hasta que un jugador sufra el cold start. Rechazada por
  ese motivo: un servicio de cron dedicado no tiene esa condición de apagado.

## Consecuencias

- Protege el objetivo de onboarding < 2 minutos del PRD sin costo de infraestructura pagada, y sin
  la trampa de desactivación silenciosa de GitHub Actions.
- Trade-off real: sigue siendo una pieza externa al sistema que depende de un tercero (el propio
  servicio de cron) — si ese servicio tiene downtime o el usuario no configura una alerta cuando
  el ping empieza a fallar, el problema reaparece igual, solo que por una causa distinta a la
  original.

# ADR 0004: Stack por componente

## Estado

Aceptado

## Contexto

RNF-4 exige despliegue en tiers gratuitos (Vercel/Render/Neon). El proyecto tiene un solo
desarrollador y no requiere SSR ni SEO (RF-1.5: sin cuentas, sin páginas indexables). El backend
necesita servir REST (ADR-0003) y manejar un canal WebSocket por sala (RF-2, RF-6.3) sin haber
elegido aún qué librería lo implementa.

## Decisión

- **Frontend:** React + Vite + Tailwind CSS, SPA sin SSR, desplegado en Vercel.
- **Backend:** Node.js + Express para REST; **Socket.IO** para el canal de tiempo real, desplegado
  en Render. Cada socket se suscribe a **dos niveles de room de Socket.IO**: una room `room:{roomId}`
  (eventos de sala: `room:state`, `tournament:bracket`, `tournament:awaiting_round`,
  `room:final_ranking`, `room:aborted`) y, al arrancar cada duelo, una room adicional
  `duel:{duelId}` (eventos de ese duelo: `duel:start`, `duel:awaiting_switch`, `duel:field_update`,
  `duel:awaiting_actions`, `duel:turn_resolved`, `duel:finished`, `duel:opponent_disconnected`).
  Esto importa específicamente en un torneo de 4, donde 2 duelos corren en paralelo dentro de la
  misma sala: sin esta separación, los eventos de ambos duelos llegarían a los 4 jugadores por
  igual y el filtrado por `duelId` quedaría implícito en el cliente.
- **Base de datos:** PostgreSQL gestionado (Neon).

## Alternativas consideradas

- **Next.js** en vez de React + Vite — da SSR y routing de archivos con integración nativa a
  Vercel, pero el producto no tiene páginas indexables ni necesidad de renderizado en servidor
  (RF-1.5); sería complejidad de framework sin un problema real que resuelva.
- **`ws` (librería WebSocket nativa)** en vez de Socket.IO — protocolo puro, mínimo overhead, pero
  obliga a implementar a mano el concepto de "sala" (mapear qué sockets pertenecen a qué `roomId`)
  y la lógica de reconexión que Socket.IO ya trae resuelta — relevante para RF-2.7 (reconexión en
  lobby/draft).

## Consecuencias

- Socket.IO da rooms y broadcast de fábrica, mapeando 1:1 con el concepto de sala de RF-2 y
  reduciendo el código necesario para RF-2.7 (timeout de reconexión) y RF-6.3 (propagación de
  estado).
- Trade-off real: Socket.IO agrega su propio protocolo por encima de WebSocket (frames adicionales,
  librería más pesada en el bundle del cliente) comparado con `ws` puro — aceptado porque el ahorro
  de código de manejo de salas pesa más que el overhead para este volumen de tráfico.

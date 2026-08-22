# ADR 0003: Contratos de API

## Estado

Aceptado

## Contexto

RNF-1 exige latencia de resolución de turno < 500ms percibidos, y RF-6.3 exige que los cambios de
estado del duelo se propaguen en tiempo real a ambos jugadores. El resto de las operaciones del
producto (RF-1 sesión, RF-2 salas, catálogo) no tiene ese requisito de tiempo real. RF-5.5
(rendición, agregada en esta misma sesión) necesita un canal para que el cliente le avise al
servidor durante un duelo en curso.

## Decisión

Contrato híbrido, ya borradeado en `TECH-DESIGN.md` §5: **REST** para sesión, catálogo y salas
(`POST /api/session`, `GET /api/pokemons`, `GET /api/type-effectiveness`, `GET /api/rooms`,
`POST /api/rooms`, `POST /api/rooms/:code/join`); **WebSocket** para todo lo que ocurre dentro de
una sala activa (ready, selección de inicial, selección de acción, resolución de turno, timeouts,
desconexiones, avance de bracket, y ahora también `duel:surrender` para RF-5.5).

## Alternativas consideradas

- **Todo por WebSocket** (sin REST) — un solo protocolo simplifica el cliente al no manejar dos
  mecanismos de red distintos, pero pierde el cacheo HTTP nativo del catálogo/listado de salas y
  dificulta probar endpoints sueltos con herramientas simples (curl/Postman) durante el desarrollo
  solo. Rechazada: el catálogo y las salas no tienen el requisito de tiempo real que sí tiene el
  duelo (RNF-1), forzarlos por WS no aporta nada.
- **GraphQL** — no se consideró seriamente: agrega una capa de tooling/dependencias que no se
  justifica para un solo desarrollador con un número de endpoints tan acotado (6 endpoints REST).

## Consecuencias

- La separación de qué protocolo usar queda gobernada por una sola pregunta ("¿esto necesita
  tiempo real?"), fácil de aplicar a futuras funcionalidades sin ambigüedad.
- Trade-off real: mantener dos superficies de contrato (tabla REST + tabla de eventos WS) implica
  el doble de documentación y de código de serialización/validación que un solo protocolo
  unificado — aceptado porque el REST es pequeño (6 endpoints) y estable.

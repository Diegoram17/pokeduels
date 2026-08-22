# ADR 0001: Componentes y estructura de repos

## Estado

Aceptado

## Contexto

El proyecto necesita un frontend (interfaz de las 5 pantallas + 2 modales de `PRD.md` §Alcance),
un backend con lógica autoritativa de combate (RF-4.12, RNF-3) y persistencia mínima (catálogo,
salas). RNF-1 exige latencia de resolución de turno < 500ms percibida y RF-6.3 exige propagación
en tiempo real de los cambios de estado del duelo, lo que obliga a un canal WebSocket además de
REST. RNF-4 exige que todo sea desplegable en tiers gratuitos (Vercel/Render/Neon). El proyecto
tiene un solo desarrollador (Diego).

## Decisión

**Monorepo** con `/frontend` (React + Tailwind) y `/backend` (Node + Express) desplegados por
separado desde el mismo repo — Vercel apunta a `/frontend`, Render apunta a `/backend`. El backend
es **un servicio único** que maneja tanto los endpoints REST (sesión, catálogo, salas) como el
canal WebSocket de duelo dentro del mismo proceso. PostgreSQL (Neon) para persistencia; PokeAPI
como servicio externo consumido solo para sprites (RNF-5).

## Alternativas consideradas

- **Polyrepo** (`pokeduels-frontend` + `pokeduels-backend` separados) — viable, pero para un solo
  desarrollador cualquier cambio de contrato de API implica coordinar 2 PRs en 2 repos distintos;
  overhead sin beneficio real dado que no hay equipos separados por componente.
- **Backend dividido en dos servicios** (uno REST, otro dedicado a WebSocket) — permitiría escalar
  el motor de tiempo real de forma independiente, pero exigiría compartir el estado de cada sala
  entre procesos (ej. vía Redis), complejidad que el volumen de este MVP (partidas cortas, tier
  gratuito, sin objetivo de escala) no justifica.

## Consecuencias

- Un solo pipeline de deploy mental por componente; el estado de las salas y duelos vive en
  memoria del mismo proceso backend, sin necesitar coordinación entre servicios.
- Trade-off real: si el tráfico creciera lo suficiente para necesitar más de una instancia del
  backend, el estado en memoria de las salas no sobrevive un reinicio ni se comparte entre
  instancias — habría que introducir un store externo (Redis) o sticky sessions antes de escalar
  horizontalmente. Aceptado como riesgo fuera de alcance de v1 (no hay objetivo de escala en el PRD).

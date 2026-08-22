# ADR 0007: Arrastre de estado entre duelos y cobertura de la matriz de tipos

## Estado

Aceptado

## Contexto

`TECH-DESIGN.md` §10 dejaba dos decisiones marcadas como "pendientes de validar", ambas con una
recomendación ya escrita pero nunca confirmada explícitamente por el usuario: (1) si el HP/PP de
un pokémon se arrastra entre los dos duelos de un torneo de 4 jugadores (RF-5.3), y (2) si la
tabla `type_effectiveness` (ADR-0002) cubre los 18 tipos completos o solo los presentes en el
catálogo de 50.

## Decisión

- **Sin arrastre de estado:** cada duelo del torneo arranca con los 6 pokémon a HP y PP completos.
  `duel_pokemon_state` se crea copiando `team_selections` al iniciar cada duelo (ya escrito así en
  TECH-DESIGN §3.2).
- **Matriz de tipos completa (18×18):** se cura la tabla `type_effectiveness` completa aunque el
  catálogo de 50 no use todos los tipos todavía.

## Alternativas consideradas

- **Arrastrar el desgaste entre rondas del torneo** — más tenso (ganar cuesta caro), pero penaliza
  al ganador de la ronda anterior frente al rival que recién entra al torneo, contradiciendo la
  intención de RF-3.5 ("todos parten en igualdad de condiciones") extendida al nivel de duelo a
  duelo. Rechazada por eso, no solo por simplicidad de implementación.
- **Matriz de tipos parcial** (solo tipos presentes en el catálogo actual) — menos datos de seed
  para curar a mano hoy, pero agregar un pokémon de un tipo nuevo al catálogo más adelante
  requeriría migrar la matriz además del catálogo. Rechazada: el costo de curar 18×18 de una vez es
  bajo y evita ese trabajo doble futuro.

## Consecuencias

- Ambas decisiones eliminan ambigüedad que hoy vivía como "recomendación sin confirmar" en
  TECH-DESIGN §10 — el schema y el seed pueden implementarse sin depender de una validación
  posterior.
- Trade-off real: curar una matriz 18×18 completa a mano (incluyendo combinaciones que el catálogo
  de 50 pokémon quizás nunca use en v1) es más trabajo de seed inicial que curar solo los tipos
  presentes — aceptado porque es trabajo de una sola vez.

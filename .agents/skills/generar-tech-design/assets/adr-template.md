# ADR {número}: {Título de la decisión}

## Estado

{Aceptado | Aceptado (heredado) — usar "heredado" solo cuando la decisión ya existía en un repo
brownfield y se documenta tal cual, sin haber sido re-discutida con el usuario.}

## Contexto

{Qué problema u obligación técnica motiva esta decisión. Qué exige el PRD o el Design.md. Qué
restricciones reales existen (equipo de una persona, plazo, stack ya elegido en otro componente,
o — en brownfield — lo que el código existente ya impone).}

## Decisión

{Qué se decidió, en una frase clara y verificable. Esta es la opción que el usuario eligió (o, si
es heredada, la que el repo existente ya tiene implementada) — nunca la que la IA prefiere sin
consultar.}

## Alternativas consideradas

{Obligatorio para decisiones nuevas. Omitir esta sección solo si el Estado es "Aceptado
(heredado)".}

- **{Alternativa A}** — {por qué era viable y por qué no se eligió}
- **{Alternativa B}** — {por qué era viable y por qué no se eligió}

## Consecuencias

- {Beneficio concreto de esta decisión}
- {Costo o trade-off real — toda decisión de arquitectura tiene uno; si no aparece ninguno, la ADR
  está incompleta}

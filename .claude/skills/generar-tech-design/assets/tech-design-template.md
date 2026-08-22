# Technical Design Document: {Nombre del proyecto}

**Tipo de proyecto:** {Greenfield | Brownfield — si es brownfield, listar el/los repo(s) existentes
revisados.}
**Design.md disponible:** {Sí | No — si no estaba disponible, el modelo de datos se derivó solo del PRD.}

## Resumen

{1 párrafo — qué se va a construir y por qué, referenciando el PRD.}

## Arquitectura de componentes

{Lista o diagrama textual: qué componentes/repos existen, qué responsabilidad tiene cada uno, y
cómo se comunican entre sí. En brownfield, distinguir qué ya existía de qué es nuevo.}

## Decisiones de arquitectura

| # | Decisión | Estado |
|---|---|---|
| [ADR-0001](adrs/0001-{slug}.md) | {título} | Aceptado |
| [ADR-0002](adrs/0002-{slug}.md) | {título} | Aceptado (heredado) |

## Modelo de datos

{Entidades principales y relaciones. Si Design.md estaba disponible, derivadas también de lo que
la interfaz revela que necesita mostrar; si no, derivadas solo del PRD.}

## Criterios de aceptación por flujo

### {Nombre del flujo 1}

- [ ] {Criterio verificable}
- [ ] {Criterio verificable}

### {Nombre del flujo 2}

- [ ] {Criterio verificable}

## Riesgos técnicos abiertos

- {Riesgo o supuesto que queda sin resolver y debería revisarse antes de avanzar}

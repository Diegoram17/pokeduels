---
name: generar-prd
description: Genera un PRD (Product Requirements Document) liviano a partir de una idea de producto, listo para revisar y pulir. Use when the user asks to generate, draft, or create a PRD, product requirements document, or define product requirements for a new project or feature.
---

# PRD Generator (Light)

## Goal

Generate a first-draft PRD that is intentionally fast and light — a starting point to review and
refine, not a finished requirements process. This skill does not replace deep product discovery;
it exists to unblock the next phase (design, architecture) with a working draft.

The primary outcome is a file written to disk: `PRD.md` at the project root, unless the user
specifies another path.

## Required Input

Before writing, the user must have provided (or be asked for, in a single concise question if
missing):

- The product idea, in a sentence or two.
- Who it's for (target user).
- The core problem it solves.

If any of these three is missing or too vague to write a meaningful PRD, ask once, concisely,
before generating. Do not invent the product idea itself — secondary details (success criteria,
edge cases) may be filled as best-effort suggestions the user is expected to revise.

## Workflow

1. Confirm the three required inputs (idea, target user, problem). Ask once if missing.
2. Generate `PRD.md` using the template in `assets/prd-template.md`, filling every section. Leave
   no placeholder unresolved — if information is missing, write a best-effort draft and flag it
   inline with `<!-- REVISAR: ... -->`.
3. Write the file to disk. Do not just paste the PRD into chat.
4. Close with a short reminder: this is a fast draft (minutes) — the real work is the review that
   follows (ambiguities, success criteria, scope, edge cases) before using it as input for design
   or architecture.

## PRD.md Sections

See `assets/prd-template.md` for the full template. Sections, in order:

- Problema
- Usuario objetivo
- Objetivo / resultado esperado
- Alcance (qué sí incluye esta versión)
- No alcance (qué explícitamente no incluye esta versión)
- Criterios de éxito
- Casos borde a contemplar
- Supuestos y riesgos abiertos

## Quality Gate

Before returning, silently check:

- No section is empty — a thin bullet beats a missing section.
- "No alcance" contains at least one explicit exclusion, not just "todo lo no mencionado".
- Success criteria are verifiable, not vague adjectives ("rápido", "intuitivo") without a
  measurable anchor.
- Any assumption the model made stands out with `<!-- REVISAR: ... -->` so the human catches it
  during review.

# Decision areas

Walk through the ones that apply to this project, in this order. Skip an area only if the PRD/
Design.md genuinely give it no room for choice (e.g., a single-screen tool with no persistence
needs no data model decision) — state why it was skipped instead of silently omitting it.

For **brownfield** projects, check the existing repo(s)/docs first for each area below. If the
area is already settled by what exists, it is not an open decision — document it as
`Aceptado (heredado)` per the ADR template and move on, unless the user explicitly asks to
reconsider it.

1. **Componentes / repos** — how many components does the system need (frontend, backend,
   service, scripts, jobs), and what is each one's responsibility? What talks to what? (Brownfield:
   read off the existing repo layout first.)
2. **Modelo de datos** — what entities exist, derived from what the PRD requires and what
   Design.md's screens reveal the user must see, when Design.md is available (the classic gap: a
   screen shows a discount, the model must have a discount field). Without Design.md, derive
   entities from the PRD alone. (Brownfield: start from the existing schema/entities.)
3. **Contratos de API** — shape of the interface between components (REST, RPC, GraphQL, direct
   function calls if it's a single deployable) and who owns the contract. (Brownfield: the existing
   contract is the starting point; new endpoints for the new module are a new decision.)
4. **Stack por componente** — language/framework choice for each component, justified against the
   project's actual constraints (team size of one, deadline, what the user already knows).
   (Brownfield: inherited by definition — a new module rarely justifies a new stack; if the user
   wants to introduce one anyway, treat it as a new decision and make the trade-off explicit.)
5. **Manejo de estado** — where state lives (client, server, both), and how consistency is kept
   between components.
6. **Resiliencia / manejo de errores** — what happens when a dependency fails, an input is
   invalid, or a component is unavailable — proportional to the project's real risk, not
   over-engineered for a course project.
7. **Cualquier decisión que el PRD fuerce** que no esté en esta lista — si el PRD menciona un
   requisito no funcional concreto (ej. "debe soportar 100 usuarios simultáneos", "debe funcionar
   offline"), esa exigencia genera su propia decisión de arquitectura, aunque no tenga categoría
   fija acá.

Do not add decisions the project doesn't need just to fill the list. A thin, honest set of ADRs
beats a padded one.

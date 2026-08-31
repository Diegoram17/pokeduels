# Security Pass — PokeDuels

> **Nota (corrección 2026-08-31):** este informe se escribió el 2026-08-22 contra un estado anterior del repo. Varias rutas que cita fueron eliminadas: `poke-duel-engine/` (dead code, borrado en Fase 5, BACKLOG #16) y `frontend/src/engine/` (vestigial, borrado en la misma fase). El motor de combate ahora vive server-side en `backend/engine/`. Los hallazgos del informe se conservan como registro histórico; las rutas específicas pueden no corresponder al árbol actual.

Fecha: 2026-08-22
Alcance revisado:

- **Producto/requisitos**: PRD.md, spec-juego-tipo-pokemon.md
- **Arquitectura/diseño**: TECH-DESIGN.md, DESIGN.md, UX-DESIGN.md, adrs/0001–0008
- **Código**: poke-duel-engine/src/engine/*.js (motor de duelos), frontend/src/**/*.ts(x) (scaffold React/Vite/TS)
- **Tests**: poke-duel-engine/test/*.js, frontend/src/engine/__tests__/*.ts
- **Configuración**: package.json/package-lock.json (frontend y engine), tsconfig*.json, vite.config.ts, .oxlintrc.json, .gitignore
- **Prototipos**: Prototipos/*.html + image-slot.js + support.js (mockups estáticos de diseño, no la app real)
- **Barrido de secretos**: repo completo (excepto node_modules/.git/dist/build)

Capas omitidas por falta de material: **CI/CD** (no existe `.github/` ni ningún otro pipeline configurado — nada que revisar), **infraestructura/despliegue en vivo** (Vercel/Render/Neon están descritos en TECH-DESIGN.md pero no hay configuración real de despliegue en el repo), **backend real** (no existe todavía — ni REST ni WebSocket ni acceso a Postgres; todo lo relacionado a autenticación/autorización en tiempo de ejecución se evaluó contra lo que el diseño *especifica*, no contra código en ejecución).

No se usó CodeGraph: no hay `.codegraph/` en este proyecto y el CLI (`gentle-ai`/`codegraph`) no está disponible en este entorno, así que la exploración se hizo con Glob/Grep/Read directamente.

## Resumen ejecutivo

PokeDuels está en una etapa muy temprana (el frontend ni siquiera está en git todavía) y, para lo que existe, el estado de seguridad es razonable: no hay secretos filtrados, no hay `.env` comprometidos, las dependencias resuelven contra el registro oficial de npm, y la documentación de diseño ya es consciente de varios riesgos y los declara explícitamente. El hallazgo más serio no es una vulnerabilidad explotable hoy — es que **el módulo central del motor de duelos (`duel.js`) no es código funcional**: es un fragmento de diff pegado que no exporta nada, rompe la importación de `tournament.js`/`index.js`, y hace que los cuatro archivos de test del engine fallen antes de ejecutar una sola aserción. Esto importa para seguridad porque ese módulo es, por diseño (ADR-0002, RNF-3), el único lugar donde se planea validar que un jugador no pueda forzar resultados de combate inválidos — hoy esa validación no existe en ningún lado, ni en el spec de forma completa ni en código.

El resto de los hallazgos son brechas de especificación (autorización por evento WebSocket documentada de forma inconsistente, validación de `switch_decision` no especificada, rate limiting solo mencionado para 2 de 15 operaciones) más algunas decisiones de diseño ya conscientemente aceptadas por el equipo (token de sesión sin expiración, dado que las partidas son efímeras). Nada de esto requiere pánico — es exactamente el tipo de brecha esperable antes de escribir el backend real — pero sí conviene cerrarlas en el spec **antes** de implementar el servidor, para no heredar las mismas inconsistencias en el código.

## Fortalezas de seguridad

- **Ningún secreto, credencial o token hardcodeado** en todo el repo (barrido completo por patrones de API key/password/token/AWS key/private key — cero coincidencias reales).
- **`.gitignore` correcto**: excluye `node_modules/`, `dist/`, `build/`, `.env`/`.env.*` (con `.env.example` permitido), archivos de editor/OS y logs.
- **`package-lock.json` del frontend limpio**: el 100% de las dependencias resuelven contra `registry.npmjs.org`, sin fuentes git/ssh anómalas.
- **Prototipos HTML limpios**: los scripts de terceros cargados por CDN (React/ReactDOM/Babel vía unpkg) usan hashes de integridad (SRI); no hay `eval` sobre datos externos alcanzable en la práctica, ni `innerHTML` con datos controlados por el usuario.
- **Diseño consciente de sus propios riesgos**: TECH-DESIGN.md §7 ya documenta explícitamente el riesgo del `sessionToken` sin expiración como una decisión aceptada, y la sección "Riesgos técnicos abiertos" ya nombra por sí sola la falta de logging/alerting en reconciliación (PL1-07). Es una buena práctica que vale la pena mantener en futuras iteraciones del diseño.
- **Principio de autoridad del servidor bien planteado**: "el servidor es la única fuente de verdad del combate" (RNF-3, TECH-DESIGN §1) es la decisión arquitectónica correcta para un juego competitivo — el problema no es la decisión, es que su enforcement en código todavía no existe (ver ENG-01).
- **Tests del engine, donde existen, usan buenos patrones**: inyección de RNG determinística (en vez de `Math.random()` global), test explícito de inmutabilidad de estado, cobertura de casos borde de PP/fallback, e integridad de bracket de torneo (sin jugadores repetidos, reset correcto de HP/PP entre rondas). Vale la pena preservar este estilo de test una vez que `duel.js` esté arreglado (ver ENG-01/ENG-02).
- **`reportDuelResult` ya valida** que el `winnerId` declarado por el llamador coincida con el `winnerId` real del duelo resuelto — una defensa real contra que alguien reclame una victoria falsa, aunque su alcance es limitado (ver ENG-04).

## Findings

### HIGH

```
ID
ENG-01
Title
El módulo central del motor de duelos (duel.js) no es código funcional: no exporta nada y rompe toda la cadena de imports y tests
Severity
HIGH
Confidence
HIGH
Category
Integridad de lógica de negocio / integridad estructural
Affected artifact
poke-duel-engine/src/engine/duel.js, tournament.js, index.js, y los 4 archivos de test del paquete
Location
poke-duel-engine/src/engine/duel.js (archivo completo, ~20 líneas)
Description
duel.js no es un módulo: es un fragmento de diff sin envolver, con un comentario en español describiendo "qué cambió", que referencia identificadores no definidos (newState, events) en el scope superior y no exporta nada. tournament.js e index.js hacen `import { createDuel, submitLead, submitSwitch, submitAction, resolveTurn }` desde este archivo, igual que los cuatro archivos de test. Confirmado contra `git show HEAD:...` — el archivo está commiteado tal cual en el commit base único del repo, no es un artefacto del working tree.
Evidence
Cargar el archivo de forma aislada en Node produce `ReferenceError: newState is not defined`; cargar tournament.js/index.js produce `SyntaxError: The requested module './duel.js' does not provide an export named 'createDuel'`. Un grep de createDuel/submitLead/resolveTurn en todo el repo no encuentra ninguna implementación real en otro lado.
Attack scenario
No es explotable hoy porque no hay nada desplegado ni un servidor que use este paquete todavía. El riesgo es que ADR-0002 y RNF-3 asumen que este módulo es (o será) el punto donde se valida que un jugador no pueda forzar un resultado de combate inválido — y ese enforcement no existe en código, solo en la intención documentada.
Potential impact
Bloquea por completo la capa de lógica de juego autoritativa. También bloquea la verificación de varios otros findings de este pase (ENG-04, ENG-05, PL1-05) porque el código que debería contener esas validaciones no existe para inspeccionar.
Existing mitigation
Ninguna — no hay una copia alternativa de la implementación real en ningún otro lugar del repo.
Recommended remediation
Reescribir duel.js con la implementación real (createDuel, submitLead, submitSwitch, submitAction, resolveTurn, applyAttackTimeout, applySwitchTimeout, forfeitDuel). Los archivos de test en poke-duel-engine/test/duel.test.js ya documentan el contrato de comportamiento esperado en detalle y pueden usarse para guiar la reescritura.
Suggested verification
`cd poke-duel-engine && npm install && npx vitest run` debería pasar de "no puede recolectar tests" a ejecutar y pasar duel.test.js y tournament.test.js.
Required change type
CODE FIX
```

### MEDIUM

```
ID
PL1-02
Title
El nickname del jugador se renderiza en 5+ superficies de UI con "escapar HTML" como única defensa, en el mismo origen donde se guarda el sessionToken en sessionStorage
Severity
MEDIUM
Confidence
MEDIUM
Category
Arquitectura/diseño — datos sensibles expuestos sin defensa en profundidad
Affected artifact
TECH-DESIGN.md §7; UX-DESIGN.md (P2, P3, P4, P5)
Location
TECH-DESIGN.md §7 ("escapar HTML al renderizar (evita XSS por nickname)") vs. UX-DESIGN.md P1 (sessionToken en sessionStorage) y las pantallas P2/P3/P4/P5 que interpolan el nickname
Description
El único control documentado contra XSS vía nickname es el escapado al renderizar, mencionado una sola vez, mientras que el nickname se interpola en al menos 5 lugares distintos de la UI (toast de "apodo en uso", toast de "starter tomado", tarjeta de estado del jugador, header del oponente, battle log). El spec nunca conecta esto con el hecho de que el mismo origen guarda en sessionStorage el único credential de autoridad de la sesión (sessionToken, ver PL1-01) para TODOS los jugadores. Si el escapado falla en cualquiera de esos puntos de render, no es un XSS cosmético — es una vía para leer el sessionToken de cualquier jugador que simplemente vea el nickname malicioso, no solo de quien lo eligió.
Evidence
TECH-DESIGN §7 lista el escapado como único control anti-XSS de nickname; UX-DESIGN.md documenta explícitamente sessionToken en sessionStorage (P1) y al menos 4 pantallas más donde el nickname de otro jugador se renderiza.
Attack scenario
Un jugador elige un nickname con un payload que sobrevive alguno de los puntos de render sin escapar; cuando otro jugador ve ese nickname (lobby, battle log, tarjeta de oponente), el payload lee sessionStorage.sessionToken de ESE jugador y lo exfiltra, permitiendo suplantarlo por el resto de la partida.
Potential impact
Escala un bug de XSS cosmético a takeover completo de sesión de cualquier jugador que vea el nickname malicioso — no solo de quien lo escribió (no es self-XSS).
Existing mitigation
El escapado está planeado, pero como control único, sin CSP ni ninguna barrera adicional documentada.
Recommended remediation
Agregar un requisito explícito de CSP (restricción de script-src) como defensa en profundidad junto al escapado, y/o centralizar el renderizado de nickname en un único componente sanitizador en vez de dejarlo ad hoc por pantalla.
Suggested verification
Criterio de aceptación: "un nickname con HTML/script se renderiza como texto literal en cada pantalla listada en UX-DESIGN.md, verificado pantalla por pantalla"; agregar requisito de header CSP a TECH-DESIGN §7.
Required change type
SPEC CHANGE
```

```
ID
PL1-03
Title
El rate limiting solo está especificado para 2 endpoints REST; está completamente ausente para eventos WebSocket en un backend de instancia única con estado en memoria
Severity
MEDIUM
Confidence
HIGH
Category
Specs/tasks — límites faltantes; Arquitectura — punto único de falla
Affected artifact
TECH-DESIGN.md §5.2, §7; adrs/0001-componentes-repos.md
Location
TECH-DESIGN.md §7 (rate limiting mencionado solo para POST /api/session y POST /api/rooms); §5.2 (tabla completa de 9 eventos cliente→servidor, ninguno menciona throttling)
Description
El resto de las 7+ acciones que mutan estado del juego (team:select_starter, room:ready, duel:select_action, duel:switch_decision, duel:surrender, etc.) viajan por WebSocket sin ninguna mención de límite de tasa en PRD, TECH-DESIGN ni los ADRs. ADR-0001 confirma que todo el estado de salas/duelos vive en memoria de un único proceso backend, así que un flood de eventos WS no tiene techo documentado y afectaría a todas las salas concurrentes, no solo a la del atacante.
Evidence
TECH-DESIGN §5.2 (sin columna ni nota de rate-limit); §7 (rate limiting acotado a 2 de 15 operaciones totales); ADR-0001 ("el estado de las salas y duelos vive en memoria del mismo proceso backend").
Attack scenario
Un cliente modificado abre un socket y satura duel:select_action o team:select_roster a alta frecuencia; sin throttling documentado, esto puede degradar o tumbar el único proceso backend, abortando todas las salas/duelos activos del servidor, no solo el propio.
Potential impact
Pérdida de disponibilidad para todos los jugadores concurrentes, amplificada por el hosting de capa gratuita (RNF-4) con poco margen de cómputo.
Existing mitigation
Rate limiting planeado (sin números concretos) para 2 de 15 operaciones expuestas al cliente.
Recommended remediation
Extender el requisito de rate limiting a eventos WebSocket con umbrales concretos por conexión/jugador; especificar el comportamiento de rechazo (drop, desconexión, backoff).
Suggested verification
Criterio de aceptación: "ningún cliente puede emitir más de N eventos duel:*/team:*/room:* por segundo; el exceso se rechaza sin afectar otras salas."
Required change type
SPEC CHANGE
```

```
ID
PL1-04
Title
El contrato de autorización por evento WebSocket es internamente inconsistente: la narrativa afirma verificación por evento, pero la tabla de payloads solo lleva sessionToken en room:join
Severity
MEDIUM
Confidence
MEDIUM
Category
Arquitectura/diseño — límite de confianza poco claro; Specs/tasks — criterios de autenticación faltantes
Affected artifact
TECH-DESIGN.md §5.2 vs §7
Location
TECH-DESIGN.md §5.2 (tabla cliente→servidor, sessionToken solo en room:join) vs §7 ("cada evento de duelo verifica que el playerId derivado del sessionToken sea participante de ese duelId")
Description
§7 afirma que cada evento de duelo se verifica contra el sessionToken del emisor, pero el contrato de payloads de §5.2 solo incluye sessionToken en room:join; los otros 8 eventos (team:select_starter, room:ready, duel:select_action, duel:switch_decision, duel:surrender, etc.) no llevan ningún campo de token. El documento nunca aclara el mecanismo alternativo (por ejemplo, vincular la identidad al socket en el momento de room:join) que haría consistente la afirmación de §7 con el contrato de §5.2, ni cómo esa vinculación se comporta en los flujos de reconexión que ya documentan RF-2.7 y ADR-0008.
Evidence
Comparación directa entre la tabla Cliente→Servidor de §5.2 y la frase citada de §7.
Attack scenario
Si la implementación real terminara confiando solo en la identidad de la conexión de socket sin re-validar en cada evento, un escenario de session-fixation/socket-hijack (proxy o MITM sobre una conexión compartida) podría enviar acciones en nombre de otro jugador sin presentar nunca un token — el spec, tal como está escrito, no puede descartar ni confirmar esto.
Potential impact
Límite de autorización ambiguo para la mayoría de los eventos que mutan el juego; dos implementaciones razonables del mismo contrato escrito podrían terminar siendo una segura y otra débil.
Existing mitigation
La intención narrativa de §7 es correcta; el hueco está en que el contrato de API no la refleja completamente.
Recommended remediation
Agregar sessionToken explícitamente a cada evento en la tabla de §5.2, o documentar explícitamente el modelo de vinculación de identidad al socket (establecido en room:join, re-establecido en reconexión) y su interacción con RF-2.7/ADR-0008.
Suggested verification
El criterio de aceptación de §12 ("Un evento WS cuyo sessionToken no pertenece al playerId... es rechazado") ya existe parcialmente — extenderlo para nombrar el mecanismo exacto y probarlo contra un escenario de reconexión-y-forjado.
Required change type
SPEC CHANGE
```

```
ID
PL1-05
Title
No hay criterios de validación especificados para duel:switch_decision, a diferencia de duel:select_action que sí está bien especificado
Severity
MEDIUM
Confidence
HIGH
Category
Specs/tasks — validación de input faltante; Producto — brecha de integridad
Affected artifact
TECH-DESIGN.md §7, §12 "Combate"
Location
TECH-DESIGN.md §7 (validación explícita solo para ataques: movimiento existe, tiene PP, pokémon activo y vivo); §12 (bullet de aceptación solo para duel:select_action)
Description
El spec es explícito y verificable sobre qué debe validar el servidor para una acción de ataque, con un bullet de criterio de aceptación correspondiente en §12. No existe una declaración equivalente para duel:switch_decision {duelId, switchTo}: nada dice que el servidor deba verificar que switchTo sea un pokémon que el jugador realmente posee en ese duelo, que no esté ya debilitado, o que no sea ya el pokémon activo. Esto es relevante para el objetivo de producto declarado (PRD O3: "el resultado del combate lo deciden las elecciones del jugador... no el azar puro"). Relacionado con ENG-01: el módulo que debería implementar esta validación (duel.js) tampoco existe todavía en código, así que hoy la brecha está tanto en el spec como en la implementación.
Evidence
TECH-DESIGN §7 (validación nombrada solo para move/PP/activo-vivo); §12 "Combate" (sin bullet para switch_decision, sí para select_action).
Attack scenario
Un cliente modificado envía duel:switch_decision {duelId, switchTo: <pokémon del rival>} o switchTo: <pokémon propio ya debilitado>; sin chequeos documentados de propiedad/estado, esto es una vía viable para forzar estado de duelo inválido una vez que exista implementación.
Potential impact
Socava la garantía de equidad/determinismo central del juego; podría romper invariantes de la máquina de estados del duelo.
Existing mitigation
Ninguna específica para esta acción.
Recommended remediation
Agregar validación explícita del switch-target a §7 y un bullet de criterio de aceptación simétrico al de select_action en §12.
Suggested verification
"duel:switch_decision con un switchTo no perteneciente al emisor, ya debilitado, o ya activo, es rechazado — nunca aceptado silenciosamente."
Required change type
SPEC CHANGE
```

```
ID
PL1-06
Title
El manejo de excepciones en el cálculo de daño ("fallar ruidosamente") no tiene contención de radio de impacto documentada en un proceso único que sirve a todas las salas
Severity
MEDIUM
Confidence
MEDIUM
Category
Arquitectura/diseño — modo de falla no evaluado contra su costo; brecha de disponibilidad
Affected artifact
TECH-DESIGN.md §4.2, §4.4; ADR-0001; ADR-0005
Location
TECH-DESIGN.md §4.2 (pseudocódigo de calcularDaño: "fallar ruidosamente... throw new Error"); ADR-0001 (instancia única, estado en memoria del mismo proceso para todas las salas)
Description
La decisión de fallar ruidosamente en vez de devolver daño corrupto (NaN) es correcta desde el punto de vista de integridad. Pero ningún documento describe cómo se captura o aísla esa excepción. Dado que ADR-0001 establece que todas las salas/duelos comparten la memoria de un mismo proceso Node, una excepción no capturada dentro de resolverRonda arriesga tumbar el proceso completo — y por lo tanto todas las salas concurrentes, no solo el duelo con el dato problemático — con recuperación solo vía la reconciliación post-crash de ADR-0008 (que limpia después del hecho, pero no previene la caída).
Evidence
TECH-DESIGN §4.2 ("si ocurre, es un bug de seed — fallar ruidosamente"); §4.4 (calcularDaño llamado sin try/catch visible alrededor); ADR-0001 (instancia única, estado en memoria compartido).
Attack scenario
No es directamente disparable por un atacante si la constraint FK sobre type_effectiveness se sostiene como está diseñada (§3.1), pero cualquier hueco de seed, bug de migración, o combinación de tipos no anticipada durante la curación pendiente del catálogo de 50 pokémon (TECH-DESIGN §10, ítem abierto) tumbaría el proceso para todos los jugadores en plena partida.
Potential impact
Corte total de servicio para todos los jugadores concurrentes por una sola fila de datos mala o un caso borde, no acotado al duelo afectado.
Existing mitigation
ADR-0008 limita la CONSECUENCIA (sin estado in_progress huérfano) pero no la OCURRENCIA de la caída; parcialmente ya aceptado bajo la decisión de "sin alta disponibilidad en v1" de ADR-0001.
Recommended remediation
Documentar un límite de aislamiento por duelo (por ejemplo, envolver resolverRonda en un try/catch que solo aborte el duelo/sala afectado, no el proceso) como requisito explícito de diseño en §4.
Suggested verification
Criterio de aceptación: "una excepción durante resolverRonda para un duelo no afecta el estado activo ni las conexiones de ninguna otra sala."
Required change type
DESIGN / ADR CHANGE
```

```
ID
ENG-03
Title
damage.js no valida su input y falla en modo abierto/silencioso ante tipos o índices de movimiento desconocidos, y su esquema de índice de movimiento no coincide con el mock del frontend
Severity
MEDIUM
Confidence
HIGH (para el desajuste de índices) / MEDIUM (para explotabilidad, porque duel.js — el llamador que debería exigir legalidad — no existe)
Category
Valores por defecto inseguros / integridad de lógica de negocio
Affected artifact
poke-duel-engine/src/engine/damage.js; frontend/src/engine/damage.ts
Location
damage.js (getEffectiveness, calculateDamage); frontend/src/engine/damage.ts (MOVE_DAMAGE)
Description
getEffectiveness devuelve un multiplicador neutro 1.0 para cualquier par de tipos no encontrado en la tabla, sin validar que los tipos sean reconocidos por el juego. calculateDamage devuelve 0 en silencio (no un error) cuando MOVES[moveIndex] no existe, en vez de rechazar el input como ilegal. Además, la tabla MOVES del engine está indexada 1-4 (constants.js) mientras que el MOVE_DAMAGE del mock del frontend está indexado 0-3, con los mismos valores de daño desplazados exactamente un índice.
Evidence
Comparación directa de poke-duel-engine/src/engine/constants.js contra frontend/src/engine/damage.ts: mismos valores de daño [25,20,15,10], índices desplazados en uno. calculateDamage(...,0,...) devuelve 0 bajo el esquema del engine actual — exactamente el "primer movimiento" del frontend.
Attack scenario
No es alcanzable hoy porque las dos implementaciones no están conectadas, pero si un cliente estilo frontend (índice 0-based) llega a enviar directamente a un servidor construido sobre poke-duel-engine (índice 1-based), cada "movimiento 1" (25 de daño) se resolvería en silencio como 0 daño — un bug de lógica de negocio real una vez que ocurra la integración.
Potential impact
Resultados de daño incorrectos o silenciosamente nulos en un duelo real, sin ningún error ni alerta que señale el desajuste.
Existing mitigation
Math.max(1, rawDamage) protege el camino válido, pero el atajo de índice inválido (if (!move) return 0) lo evita por completo.
Recommended remediation
Hacer que calculateDamage lance/rechace ante un moveIndex no reconocido en vez de devolver 0; unificar el esquema de numeración de movimientos entre poke-duel-engine y cualquier contrato futuro con el cliente antes de conectar el frontend al engine real.
Suggested verification
Agregar un test que confirme que calculateDamage lanza (no devuelve 0) para índices fuera de rango de MOVES; agregar un test de contrato que compare los índices del frontend contra las claves de MOVES del engine una vez integrados.
Required change type
CODE FIX (calculateDamage) + SPEC CHANGE (unificar numeración de índice de movimiento)
```

### LOW

```
ID
PL1-01
Title
El sessionToken es el único credential de sesión, sin expiración ni rotación, guardado en claro en sessionStorage
Severity
LOW
Confidence
HIGH
Category
Arquitectura/diseño — ciclo de vida de autenticación débil
Affected artifact
TECH-DESIGN.md §7, §3.1; UX-DESIGN.md P1
Location
TECH-DESIGN.md §7; esquema players.session_token (§3.1)
Description
sessionToken es un UUID emitido una vez al ingresar el nickname, nunca expira, nunca se rota, y se guarda en sessionStorage del navegador en texto plano. Quien lo obtenga puede suplantar al jugador por el resto de la partida.
Evidence
TECH-DESIGN §7: "cualquiera que obtenga un sessionToken puede actuar como ese jugador... Es un riesgo aceptado en v1 dado que las partidas son efímeras y no hay nada de valor asociado a la identidad."
Attack scenario
El token se filtra vía una computadora compartida/pública, acceso a devtools, o un proxy/log que capture el handshake WS; el atacante actúa en nombre de la víctima por el resto de esa partida.
Potential impact
Impersonación/griefing limitado a una sola partida; sin consecuencia entre sesiones ni a nivel de cuenta, dado que no hay identidad persistente.
Existing mitigation
Ya documentado y aceptado explícitamente como decisión deliberada de v1.
Recommended remediation
Ninguna acción requerida más allá de lo ya aceptado; si se endurece más adelante, agregar expiración corta + reemisión al reconectar.
Suggested verification
N/A (riesgo ya aceptado, no un defecto)
Required change type
ACCEPT RISK
```

```
ID
PL1-07
Title
No hay logging/alerting para reinicios de backend que abortan duelos/torneos en curso (brecha ya autoidentificada en el propio documento)
Severity
LOW
Confidence
HIGH
Category
Specs/tasks — manejo de error no especificado para una operación irreversible y sensible
Affected artifact
TECH-DESIGN.md ("Riesgos técnicos abiertos"); ADR-0008
Location
TECH-DESIGN.md, sección de cierre "Riesgos técnicos abiertos"
Description
La lógica de reconciliación de ADR-0008 (abortar todos los duelos/salas in_progress al reiniciar el backend) es un buen diseño de recuperación determinística, pero el propio documento señala que no hay observabilidad de cuándo/cuán seguido ocurre. Es una operación irreversible y visible para el jugador (se descarta el resultado de un torneo completo) sin ningún rastro de auditoría documentado más allá de los propios estados en la base de datos.
Evidence
Cita directa de TECH-DESIGN.md: "Sigue faltando logging/alerting que avise cuándo ocurre un reinicio con partidas en curso."
Attack scenario
N/A directamente, pero la ausencia de alerting significa que reinicios forzados repetidos (por ejemplo, si se explota PL1-06 o el flood de PL1-03 para tumbar el proceso) pasarían inadvertidos operacionalmente.
Potential impact
Respuesta a incidentes retrasada; imposible distinguir un reinicio de deploy normal de un patrón de caídas causado por abuso o un bug de datos.
Existing mitigation
La lógica de reconciliación en sí (ADR-0008) ya previene estado huérfano/indefinido; solo falta la capa de observabilidad.
Recommended remediation
Agregar un requisito de logging/alerting a ADR-0008 o TECH-DESIGN §7 para cada evento de reconciliación (cantidad de salas/duelos abortados, timestamp).
Suggested verification
"Todo arranque de backend que encuentre ≥1 duelo in_progress emite un log/alerta estructurado con la cantidad y los IDs de sala."
Required change type
SPEC CHANGE
```

```
ID
PL1-08
Title
La derrota automática por desconexión durante un duelo activo no tiene período de gracia ni distingue desconexión voluntaria de accidental
Severity
LOW
Confidence
MEDIUM
Category
Producto/requisitos — brecha de disponibilidad/equidad
Affected artifact
PRD.md RF-6.2; TECH-DESIGN.md §6, §10
Location
PRD.md RF-6.2: "Si un jugador se desconecta durante un duelo, se notifica al rival y este gana automáticamente ese duelo"
Description
La desconexión durante un duelo activo es una derrota automática e irreversible, sin ninguna ventana de reconexión (a diferencia de la fase de lobby/draft, que sí tiene 60s de gracia según RF-2.7). La regla trata igual una caída de red genuina y una desconexión inducida deliberadamente, y el diseño no evalúa esto desde la perspectiva de un actor malicioso.
Evidence
PRD RF-6.2 y TECH-DESIGN §6/§10 confirman cero reconexión durante el duelo activo, en contraste directo con los 60s de gracia documentados para RF-2.7.
Attack scenario
Un jugador que va perdiendo un duelo se beneficia si su rival pierde la conexión; el diseño no ofrece ninguna tolerancia ni siquiera ante caídas accidentales en el momento más consecuente del juego.
Potential impact
Jugadores legítimos pierden duelos de forma irrecuperable por problemas de red transitorios.
Existing mitigation
TECH-DESIGN §6 lo documenta como decisión cerrada y conocida, con reconexión listada como mejora futura.
Recommended remediation
Considerar un período de gracia corto (10-15s) durante duelos activos, en línea con el patrón ya usado en RF-2.7.
Suggested verification
Decisión de producto — no requiere verificación hasta que cambie el alcance.
Required change type
PRODUCT / REQUIREMENT CHANGE
```

```
ID
PL1-09
Title
No hay política de moderación de contenido para nicknames visibles a otros jugadores en vivo
Severity
LOW
Confidence
HIGH
Category
Specs/tasks — sin criterios de aceptación de seguridad donde razonablemente se necesitan
Affected artifact
PRD.md RF-1; UX-DESIGN.md P1
Location
PRD.md RF-1.1–RF-1.4; UX-DESIGN.md P1
Description
Los nicknames son texto libre, visibles en tiempo real a otros extraños reales en lobby, draft y pantallas de batalla. Ningún documento menciona una política de contenido (groserías, suplantación) más allá de límites de longitud (3-20 caracteres) y unicidad por sala.
Evidence
PRD RF-1.1–RF-1.4 y UX-DESIGN P1 solo especifican longitud y espacios; ninguna otra regla de contenido en todo el corpus.
Attack scenario
Un jugador elige un nickname ofensivo o de suplantación, visible para otros extraños en un lobby público (P2 lista todas las salas en espera con los nicknames de sus ocupantes).
Potential impact
Bajo — no existe canal de chat que agrave el abuso (fuera de alcance explícitamente), y las partidas son de corta duración sin reputación persistente.
Existing mitigation
Ninguna más allá de longitud/unicidad.
Recommended remediation
Opcional: agregar un filtro/blocklist liviano como requisito (aunque sea diferido); como mínimo, documentar esto como una decisión de alcance conscientemente aceptada.
Suggested verification
N/A a menos que se adopte.
Required change type
ACCEPT RISK
```

```
ID
PL1-10
Title
No hay ningún requisito explícito de transporte seguro (HTTPS/WSS) en los requisitos no funcionales documentados
Severity
LOW
Confidence
MEDIUM
Category
Arquitectura/diseño — flujo de datos sensibles sin protección en tránsito (por omisión)
Affected artifact
PRD.md "Requisitos no funcionales"; TECH-DESIGN.md §7
Location
PRD.md RNF-1 a RNF-6; TECH-DESIGN §7 "Consideraciones de seguridad"
Description
Dado que sessionToken (PL1-01) es el único credential de autoridad de todo el sistema y viaja tanto por REST como por WebSocket, la sección de consideraciones de seguridad no menciona la necesidad de HTTPS/WSS. Vercel y Render probablemente aplican TLS por defecto, pero el requisito nunca se declara explícitamente.
Evidence
Lectura completa de la tabla de RNF y de TECH-DESIGN §7 — ninguna menciona HTTPS/WSS/TLS.
Attack scenario
Una mala configuración (fallback de desarrollo dejado activo, o un proxy que termine TLS incorrectamente) degrada silenciosamente la conexión WS a texto plano, exponiendo tokens de sesión a interceptación de red.
Potential impact
Bajo dado el comportamiento por defecto de las plataformas, pero vale la pena declararlo explícitamente dado que el tráfico lleva el credential de autoridad del sistema.
Existing mitigation
Implícita: terminación TLS por defecto en Vercel/Render.
Recommended remediation
Agregar "todo el tráfico cliente-servidor (REST y WebSocket) DEBE usar HTTPS/WSS" como RNF explícito o bullet de §7.
Suggested verification
Test de aceptación: una conexión en texto plano ws:// contra el backend de producción es rechazada/redirigida.
Required change type
SPEC CHANGE
```

```
ID
PL1-11
Title
El mecanismo de reconexión con período de gracia (RF-2.7) podría refrescarse repetidamente para retener indefinidamente una reserva de starter o cupo de sala
Severity
LOW
Confidence
LOW
Category
Producto/requisitos — abuso de funcionalidad legítima
Affected artifact
PRD.md RF-2.7; TECH-DESIGN.md §6
Location
PRD.md RF-2.7
Description
El temporizador de 60 segundos está completamente especificado para una desconexión sostenida única, pero ningún documento aclara si desconexiones/reconexiones rápidas repetidas (flapping) reinician el temporizador cada vez, ni si existe algún cooldown que lo evite.
Evidence
RF-2.7 y TECH-DESIGN §6 especifican por completo el comportamiento de una sola desconexión pero no dicen nada sobre patrones de reconexión repetida.
Attack scenario
Un jugador se desconecta y reconecta repetidamente justo antes de los 60s para mantener reservado un starter (por ejemplo "Pikachu") sin nunca marcarse listo, bloqueando ese starter para otros jugadores de la sala.
Potential impact
Denegación de un recurso puntual (un starter o un cupo de sala) a otros jugadores de esa sala específica; trivialmente evitable por esos jugadores creando otra sala.
Existing mitigation
Ninguna declarada; este es un hueco inferido, no confirmado — el comportamiento real podría ya prevenirlo (por ejemplo, un temporizador fijado una sola vez por jugador en vez de por cada evento de desconexión).
Recommended remediation
Aclarar en TECH-DESIGN §6 si el temporizador de 60s se reinicia en cada reconexión y, si es así, considerar un tope de intentos de reconexión o de tiempo total retenido sin marcarse listo.
Suggested verification
"Un jugador que se desconecta/reconecta repetidamente no puede retener un starter/cupo de sala por más de [N] segundos acumulados sin marcarse listo."
Required change type
SPEC CHANGE
```

```
ID
PL1-12
Title
La dependencia de un cron/uptime service de terceros para mitigar el cold start de Render no tiene monitoreo sobre su propia falla (brecha ya autoidentificada en el ADR)
Severity
LOW
Confidence
HIGH
Category
Arquitectura/diseño — dependencia externa mal gestionada
Affected artifact
adrs/0006-resiliencia-cold-start.md
Location
ADR-0006, sección "Consequences"
Description
La mitigación elegida para el cold start de Render (un servicio de cron/uptime externo pegándole a /health) es en sí misma una dependencia de terceros sin monitoreo ni fallback documentado si ese servicio falla o nadie configura alertas sobre pings fallidos. El propio ADR reconoce este riesgo residual sin asignarle una acción de seguimiento.
Evidence
Cita directa de ADR-0006: "sigue siendo una pieza externa de terceros — si tiene downtime o nadie configura una alerta sobre pings fallidos, el cold start reaparece igual."
Attack scenario
N/A — brecha operacional/de confiabilidad, no disparada por un atacante.
Potential impact
Los retrasos de cold start reaparecen en silencio, degradando el criterio de éxito de onboarding del PRD (<2 minutos) sin mecanismo de detección documentado.
Existing mitigation
El propio ADR es la mitigación principal (elegir un servicio de cron dedicado en vez de GitHub Actions específicamente para evitar la desactivación silenciosa a los 60 días); el hueco de "quién vigila al vigilante" queda abierto por admisión propia del ADR.
Recommended remediation
Agregar monitoreo/alerta sobre los propios pings de health-check (por ejemplo, un dead-man's-switch) como ítem de seguimiento.
Suggested verification
N/A hasta que se adopte; llevarlo como ítem de backlog referenciando ADR-0006.
Required change type
PROCESS / HARNESS CHANGE
```

```
ID
ENG-04
Title
reportDuelResult valida correctamente que el winnerId declarado coincida con el estado resuelto del duelo, pero nada protege a los objetos DuelState/TournamentState en sí de ser forjados por el llamador
Severity
LOW
Confidence
LOW (no existe todavía capa de servidor/transporte que determine si esto es alcanzable por una parte no confiable)
Category
Confianza en estado provisto por el llamador / diseño
Affected artifact
poke-duel-engine/src/engine/tournament.js
Location
tournament.js (reportDuelResult)
Description
reportDuelResult hace lo correcto con lo que puede chequear: lanza si el duelo no existe, si duel.phase no es 'FINISHED', o si el winnerId declarado no coincide con duel.winnerId. Pero duel/tournament son objetos JS planos sin ningún tipo de firma, hash o correlación de sesión del lado del servidor — la garantía de seguridad completa depende de que esos objetos sean siempre la copia canónica del servidor, algo que esta librería de funciones puras no puede hacer cumplir por sí sola.
Evidence
tournament.js (el único chequeo anti-suplantación es la comparación de winnerId); no hay ningún chequeo de que los objetos duel/tournament recibidos sean la copia canónica del servidor y no una modificada por el llamador.
Attack scenario
Solo relevante una vez que exista un servidor que acepte objetos de estado provistos por el cliente en vez de referenciar estado propio por ID. No hay código de servidor en el alcance de este pase, así que es una nota de diseño prospectiva, no una vulnerabilidad viva.
Potential impact
Si alguna vez se conecta a un endpoint que confía en objetos de estado provistos por el cliente, esto permitiría forjar resultados de torneo.
Existing mitigation
El chequeo cruzado de winnerId (una fortaleza real, vale la pena preservarla).
Recommended remediation
Cuando se construya la capa de servidor (ADR-0002 ya especifica persistencia server-side en Postgres y RNF-3 autoridad del servidor), asegurar que el estado de duel/tournament siempre se busque por ID desde el almacenamiento del servidor, nunca se acepte como objeto completo desde el cliente.
Suggested verification
N/A hasta que exista código de servidor — revisar los handlers de API/WS cuando se implementen RF-4/RF-6.3.
Required change type
DESIGN / ADR CHANGE
```

```
ID
ENG-05
Title
createTournament valida la cantidad de jugadores pero no la unicidad de sus ids ni la colisión de tournamentId
Severity
LOW
Confidence
LOW
Category
Confianza en estado provisto por el llamador
Affected artifact
poke-duel-engine/src/engine/tournament.js
Location
tournament.js (createTournament)
Description
createTournament lanza a menos que players.length sea exactamente 2 o 4 (una validación real y funcional). No valida que los ids de jugador sean únicos, ni que tournamentId tenga formato válido/sea único — ambos se usan directamente para construir claves de objeto e IDs de duelo sin ningún chequeo de colisión o unicidad.
Evidence
Solo existe el chequeo de cantidad de jugadores; tournamentId se interpola directamente en IDs de duelo sin validación.
Attack scenario
Si tournamentId o los ids de jugador llegan a derivarse de input de cliente sin sanitizar en vez de identificadores generados por el servidor, ids duplicados podrían sobrescribir en silencio estado de torneo/duelo indexado por esos ids.
Potential impact
Confusión/sobrescritura de estado entre torneos o jugadores que comparten un id, si esta función llega a llamarse con identificadores influenciados por el cliente.
Existing mitigation
Ninguna más allá del chequeo de cantidad de jugadores.
Recommended remediation
Validar formato/unicidad de tournamentId y unicidad de ids de jugador dentro de un torneo al crearlo.
Suggested verification
Agregar un test que confirme que createTournament rechaza ids de jugador duplicados.
Required change type
CODE FIX
```

```
ID
ENG-06
Title
Archivo de test duplicado y roto dentro de src/engine/ muestra el mismo patrón de "fragmento de diff pegado" que duel.js
Severity
LOW
Confidence
HIGH
Category
Proceso/harness — higiene del repositorio
Affected artifact
poke-duel-engine/src/engine/tournament.test.js (vs. el canónico poke-duel-engine/test/tournament.test.js)
Location
poke-duel-engine/src/engine/tournament.test.js
Description
Este archivo duplica un escenario ya cubierto por poke-duel-engine/test/tournament.test.js, pero es en sí mismo un fragmento: abre directamente con un it(...) sin ningún import, y referencia createTournament, submitLead, submitAction, resolveTurn, reportDuelResult, ninguno de los cuales está definido o importado en el archivo. Como vitest.config.js no restringe test.include, el glob por defecto de vitest lo recoge junto con el directorio test/ canónico.
Evidence
Primera línea es un comentario "// tests/tournament.test.js (fragmento añadido)" seguido directamente de un it(...) de nivel superior, sin ninguna línea de import; vitest.config.js no tiene override de include.
Attack scenario
N/A — hallazgo de higiene de tests.
Potential impact
Un segundo archivo de test garantizado a fallar agrega ruido a los resultados de CI, y refleja un patrón repetido en el repo (visto también en duel.js) de commitear fragmentos de diff/patch en vez de ediciones de archivo reales.
Existing mitigation
Ninguna.
Recommended remediation
Eliminar poke-duel-engine/src/engine/tournament.test.js (su escenario ya existe correctamente en poke-duel-engine/test/tournament.test.js), y agregar un test.include que restrinja vitest al directorio test/.
Suggested verification
`vitest run` debería listar los archivos recolectados y confirmar que solo test/*.test.js se recogen después del arreglo.
Required change type
PROCESS / HARNESS CHANGE
```

```
ID
ENG-07
Title
poke-duel-engine no tiene lockfile para sus dependencias
Severity
LOW
Confidence
MEDIUM
Category
Higiene de dependencias / supply-chain
Affected artifact
poke-duel-engine/package.json
Location
poke-duel-engine/package.json (devDependency vitest: ^1.0.0)
Description
poke-duel-engine declara una devDependency con rango caret y no tiene package-lock.json/pnpm-lock.yaml/yarn.lock en su directorio, así que el árbol de dependencias resuelto exacto no está fijado. En contraste, frontend/ sí tiene package-lock.json.
Evidence
No existe archivo de lockfile en poke-duel-engine/; frontend/package-lock.json sí está presente.
Attack scenario
Bajo — una sola devDependency, sin dependencias de runtime, no publicado. Un futuro npm install podría traer silenciosamente una versión mayor de vitest distinta a la probada.
Potential impact
Ejecuciones de test no reproducibles entre máquinas/CI; hueco menor de higiene de supply-chain.
Existing mitigation
Ninguna.
Recommended remediation
Correr npm install y commitear el package-lock.json generado.
Suggested verification
Confirmar que package-lock.json existe y está en git después de generarlo.
Required change type
PROCESS / HARNESS CHANGE
```

```
ID
FE-01
Title
El tsconfig del frontend no habilita explícitamente el modo strict de TypeScript
Severity
LOW
Confidence
LOW (sin bug concreto encontrado todavía en el poco código revisado)
Category
Configuración insegura / type-safety
Affected artifact
frontend/tsconfig.app.json, frontend/tsconfig.node.json
Location
compilerOptions de ambos archivos
Description
Ambos tsconfig habilitan algunos flags individuales (noUnusedLocals, noUnusedParameters, noFallthroughCasesInSwitch) pero nunca "strict": true (que agrupa strictNullChecks, noImplicitAny, strictFunctionTypes, etc.).
Evidence
Lectura completa de ambos bloques compilerOptions — sin flag strict, ni individual ni vía el paraguas "strict".
Attack scenario
N/A directamente — es un hueco de configuración que habilita bugs latentes, no una vulnerabilidad explotable por sí sola.
Potential impact
A medida que crezca el código (manejo de estado, conexión al engine, mensajes WS), la ausencia de strictNullChecks en particular facilita enviar bugs de manejo de null/undefined sin que el compilador los detecte.
Existing mitigation
Ninguna causando un bug concreto visible todavía — el código es pequeño y simple.
Recommended remediation
Agregar "strict": true a ambos tsconfig antes de que el código crezca más.
Suggested verification
`tsc -b` debería seguir pasando después de habilitar strict; cualquier error nuevo que aparezca debería triarse antes de mergear.
Required change type
CODE FIX
```

### INFO

```
ID
PL1-13
Title
El cliente hace requests directos a un API de terceros (PokeAPI) sin nota de CSP/allowlist
Severity
INFO
Confidence
MEDIUM
Category
Arquitectura/diseño — dependencia externa no gestionada; brecha menor de privacidad
Affected artifact
TECH-DESIGN.md §2; PRD.md RNF-5
Location
TECH-DESIGN.md §2 (diagrama de arquitectura); PRD RNF-5
Description
El diagrama muestra al cliente pidiendo sprites directamente y cross-origin a PokeAPI en vez de proxear por el backend. Es una elección razonable y de bajo riesgo para una API pública de imágenes no sensibles, pero no se menciona ningún allowlist de CSP para ese origen, ni la implicación menor de privacidad de que la IP/user-agent de cada jugador queda expuesta a PokeAPI en cada carga de sprite.
Evidence
TECH-DESIGN §2 (flecha directa Frontend→PokeAPI); PRD RNF-5 confirma que los sprites no se almacenan localmente.
Attack scenario
Ninguno material — PokeAPI es una API pública estable y conocida; el peor caso es exposición menor de metadata a un tercero.
Potential impact
Insignificante para el modelo de amenazas de este proyecto.
Existing mitigation
El PRD ya lista "PokeAPI caída o rate-limited" como riesgo conocido con mitigación de cacheo.
Recommended remediation
Ninguna acción necesaria; opcionalmente documentar un allowlist de CSP img-src para el dominio de PokeAPI en TECH-DESIGN §7.
Suggested verification
N/A.
Required change type
ACCEPT RISK
```

```
ID
FE-02
Title
El mock de motor de duelos del frontend (damage.ts, bot.ts) calcula resultados enteramente del lado del cliente, explícitamente etiquetado como mock a la espera del combate autoritativo del servidor
Severity
INFO
Confidence
HIGH
Category
Confianza del lado del cliente / observación adyacente a arquitectura
Affected artifact
frontend/src/engine/damage.ts, frontend/src/engine/bot.ts, frontend/src/state/schema.ts
Location
Comentarios en los tres archivos citados
Description
El frontend tiene hoy su propia lógica de daño/selección de movimiento, calculada enteramente en el cliente, sin conexión a poke-duel-engine ni ida y vuelta al servidor. Está explícita y repetidamente documentado en el código como un stand-in mock, consistente con ADR-0002/ADR-0003 (combate autoritativo del servidor, todavía no construido). No se trata como vulnerabilidad dado el etiquetado explícito de "mock" y lo temprano del proyecto.
Evidence
Comentarios directos en los tres archivos citados.
Attack scenario
Ninguno actualmente — nada de este mock se presenta como resultado real de juego que un servidor vaya a confiar.
Potential impact
Ninguno en esta etapa. Relevante solo si este mock se deja como fallback/modo offline sin estar claramente separado de cualquier flujo que reporte resultados a un backend real.
Existing mitigation
Etiquetado explícito de "mock" en comentarios y nombres de schema.
Recommended remediation
Cuando se implemente el flujo real de duelo vía WebSocket (ADR-0003), asegurar que este camino mock se elimine o quede claramente aislado (por ejemplo, modo dev-only/offline) para que nunca pueda confundirse con o sustituir al flujo autoritativo.
Suggested verification
N/A en esta etapa — revisar cuando comience el trabajo de integración con el servidor.
Required change type
ACCEPT RISK (en esta etapa) / DESIGN-ADR CHANGE (cuando comience la integración con el servidor)
```

```
ID
TEST-01
Title
No existen tests de límites de autorización/multijugador en ningún lugar del alcance revisado
Severity
INFO
Confidence
HIGH
Category
Brecha de cobertura de tests
Affected artifact
poke-duel-engine/test/*, frontend/src/engine/__tests__/*
Location
N/A (ausencia, no una línea específica)
Description
Ningún test revisado ejercita la noción de "qué jugador puede enviar una acción para qué duelo/slot" — por ejemplo, nada verifica que el jugador p2 no pueda enviar una acción en nombre de p1. Dada la naturaleza PvP explícita del producto esto importará, pero su ausencia es apropiada en esta etapa porque todavía no hay capa de servidor/sesión contra la cual hacer cumplir o probar ese límite.
Evidence
Lectura completa de todos los archivos de test del engine y del frontend — ningún test afirma rechazo basado en identidad/autorización del llamador.
Attack scenario
N/A — informativo, no un bloqueante para un paquete en esta etapa.
Potential impact
Ninguno todavía; se documenta para que no se olvide una vez que exista una capa de servidor/sesión.
Existing mitigation
N/A.
Recommended remediation
Una vez que exista código de servidor/sesión, agregar tests que confirmen que un llamador solo puede enviar acciones/reportar resultados para duelos de los que es participante.
Suggested verification
N/A todavía.
Required change type
PRODUCT / REQUIREMENT CHANGE
```

```
ID
PART3-01
Title
Sin entrada en .gitignore para artefactos locales de herramientas de despliegue (Vercel/Render CLI)
Severity
INFO
Confidence
LOW
Category
Configuración / higiene de secretos
Affected artifact
.gitignore
Location
.gitignore (raíz)
Description
El stack declarado (TECH-DESIGN.md) apunta a Vercel (frontend) y Render (backend). Herramientas como `vercel dev`/`vercel link` crean una carpeta local `.vercel/` (vinculación de proyecto/org, a veces tokens cacheados según la versión del CLI) que es una entrada convencional de gitignore pero no está presente hoy. No existe tal carpeta en el repo actualmente ni evidencia de que estas CLIs se hayan usado localmente todavía.
Evidence
.gitignore completo no contiene entrada para .vercel u otro artefacto de CLI de plataforma.
Attack scenario
No explotable hoy — no existe carpeta .vercel en el repo. Es una brecha preventiva: si más adelante alguien corre vercel link/vercel dev localmente sin agregar antes este patrón, podría commitearse metadata de vinculación de proyecto por accidente.
Potential impact
Bajo — project.json de Vercel normalmente solo contiene IDs de org/proyecto, no secretos, pero es buena práctica excluirlo igual.
Existing mitigation
.env/.env.* ya cubre los archivos que realmente llevarían secretos (connection strings, tokens de API) de este stack.
Recommended remediation
Agregar .vercel (y el patrón equivalente de Render si se usa su CLI localmente) a .gitignore de forma proactiva antes del primer uso local del CLI de Vercel.
Suggested verification
Re-chequear .gitignore cuando se configure el despliegue real (territorio de deploy-pass, no un defecto vivo hoy).
Required change type
PROCESS / HARNESS CHANGE
```

## Prioridad

1. **ENG-01** — Reescribir duel.js. Es la base que bloquea la verificación de ENG-02 (suite de tests), ENG-04, ENG-05, y la implementación real de PL1-05. Hacerlo junto con **ENG-06** (borrar el test fragmentado duplicado) ya que es la misma limpieza.
2. **ENG-03** — Unificar el esquema de índice de movimiento (0-based vs 1-based) entre engine y frontend antes de conectar ambos, para no heredar un bug de daño silencioso en la integración.
3. Cerrar los huecos de spec antes de escribir el backend real: **PL1-04** (contrato de autorización WS), **PL1-05** (validación de switch_decision), **PL1-03** (rate limiting en WS), **PL1-06** (aislamiento de fallos por duelo). Estos cuatro son baratos de arreglar en el documento y caros de arreglar después de que el código ya asuma el comportamiento ambiguo actual.
4. **PL1-02** — Agregar el requisito de CSP como defensa en profundidad antes de que la UI de renderizado de nickname se consolide en varios componentes.
5. Housekeeping de bajo costo, en cualquier momento: **ENG-07** (lockfile), **FE-01** (TS strict), **PART3-01** (.gitignore), **PL1-07** (logging de reconciliación), **PL1-12** (monitoreo del health-check externo).
6. **PL1-10**, **PL1-11**, **ENG-04**, **ENG-05** — revisar cuando se construya la capa de servidor real; no son urgentes hoy porque no hay servidor todavía.
7. Riesgos ya aceptados o informativos (**PL1-01**, **PL1-09**, **PL1-13**, **FE-02**, **TEST-01**) — sin acción por ahora, re-evaluar si cambia el alcance del producto.

## Gobernanza / Decisión requerida

- **PL1-01** (ACCEPT RISK) — sessionToken sin expiración. Ya aceptado explícitamente por el equipo en TECH-DESIGN.md §7; se lista aquí solo por completitud, no requiere nueva decisión.
- **PL1-06** (DESIGN / ADR CHANGE) — requiere decidir si se agrega aislamiento de fallos por duelo al diseño de resolverRonda; es una decisión de arquitectura, no algo que este pase pueda resolver.
- **PL1-08** (PRODUCT / REQUIREMENT CHANGE) — si se agrega un período de gracia a la desconexión durante duelos activos es una decisión de producto (afecta el alcance de v1), no técnica.
- **PL1-09** (ACCEPT RISK) — falta de moderación de nicknames. Requiere que el equipo decida explícitamente si esto es un riesgo aceptado o si se agrega un filtro, dado que hoy no está ni implementado ni documentado como decisión consciente.
- **PL1-13** (ACCEPT RISK) — llamadas directas del cliente a PokeAPI. Bajo riesgo, pero formalmente requiere que alguien lo acepte como decisión en vez de dejarlo implícito.
- **ENG-04** (DESIGN / ADR CHANGE) — reforzar que la intención de ADR-0002 ("autoridad del servidor") signifique explícitamente "estado buscado por ID en el servidor", no "estado aceptado del cliente y luego validado". Requiere una decisión arquitectónica antes de escribir el servidor.
- **FE-02** (ACCEPT RISK hoy / DESIGN-ADR CHANGE más adelante) — el equipo debe decidir explícitamente el ciclo de vida del mock de frontend cuando comience la integración con el servidor real, para que no sobreviva por accidente como un modo paralelo no autoritativo.
- **TEST-01** (PRODUCT / REQUIREMENT CHANGE) — ítem de trabajo futuro, no un defecto actual; requiere que se agregue al backlog cuando exista capa de servidor/sesión.

Ningún otro finding de este pase requiere una decisión de producto o arquitectura — el resto son CODE FIX, TEST FIX, SPEC CHANGE o PROCESS / HARNESS CHANGE, resolvibles sin necesidad de sign-off adicional.

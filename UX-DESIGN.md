# UX / UI Design — Pokémon Duels (v1)

> Partes de este documento describen el estado pre-Fase-7 (antes del reskin contra prototipos). El estado visual vigente son los prototipos en `Prototipos/` + `frontend/src/assets/pokeduels-design-system.css` (tokens `.pd-*`). La decisión de producto RNF-2 (2026-08-25) es desktop-only; las secciones responsive (Móvil/Tablet) no aplican.

**Documentos asociados:** `PRD.md` · `TECH-DESIGN.md`
**Stack frontend:** React + Vite + Tailwind CSS (SPA desplegada en Vercel)

**Notación de íconos en los wireframes:** `[icon:nombre]` = ícono de Material Symbols Outlined (ver
`DESIGN.md` — "Nada de emoji"). `[sprite:pokémon]` = imagen real del pokémon consumida desde
PokeAPI (RNF-5), no es un ícono.

**Referencia visual real:** las 6 pantallas en `Prototipos/*.html` (más `Prototipos/1.pantalla_de_ingreso/`)
implementan `DESIGN.md` en HTML/CSS real, con un sistema compartido en
`Prototipos/assets/pokeduels-design-system.css`. Los wireframes ASCII de este documento son la
especificación de **flujo e interacción** (qué pasa, en qué orden, qué estados existen); para el
detalle visual exacto (colores, tipografía, componentes) el prototipo manda, no el ASCII. Nota:
el CSS del prototipo es vainilla (sin Tailwind) por conveniencia de maquetado — no reabre ADR-0004,
que sigue fijando Tailwind para la implementación real en React.

---

## 1. Principios de diseño

| Principio | Aplicación concreta |
|---|---|
| **Cero fricción de entrada** | Un solo input (nickname) separa al usuario de estar jugando |
| **El estado siempre visible** | HP en número absoluto y %, PP por ataque, contador de turno, quién está listo |
| **El servidor manda, la UI informa** | Toda acción se envía como intención y la UI muestra estado `pending` hasta la confirmación del servidor |
| **Nunca dejar al jugador sin saber qué pasa** | Todo estado de espera tiene mensaje explícito ("Esperando a que Ana elija…") |
| **Legible en móvil** | El tablero de duelo funciona en vertical; los ataques son targets grandes |

## 2. Mapa de navegación

```
┌────────────────┐
│  P1 Nickname   │
└───────┬────────┘
        ▼
┌────────────────┐◄──────────────────────────┐
│   P2 Lobby     │                           │
└───────┬────────┘                           │
        │ crear / unirse                     │ "Volver al Lobby"
        ▼                                    │
┌────────────────┐                           │
│   P3 Draft     │  ← starters bloqueados    │
└───────┬────────┘     en tiempo real        │
        │ Ready                              │
        ▼                                    │
┌────────────────┐                           │
│ P4 Espera/     │◄────────┐                 │
│    Bracket     │         │ vuelve entre    │
└───────┬────────┘         │ rondas          │
        │ Entrar al duelo  │                 │
        ▼                  │                 │
┌────────────────┐         │                 │
│  P5 Duelo      │─────────┘                 │
│                │                           │
│  ◄─► Modal A   │ (cambio de pokémon)       │
└───────┬────────┘                           │
        │ fin del torneo                     │
        ▼                                    │
┌────────────────┐                           │
│ Modal B        │───────────────────────────┘
│ Ranking Final  │
└────────────────┘
```

---

## 3. Pantallas

### P1 · Ingreso Rápido

```
┌──────────────────────────────────────────┐
│                                          │
│          [icon:bolt] POKÉMON DUELS        │
│         Duelos por turnos en línea       │
│                                          │
│   ┌────────────────────────────────┐     │
│   │  Ingresa tu Nickname           │     │
│   └────────────────────────────────┘     │
│   [icon:warning] Entre 3 y 20 caracteres  │
│                                          │
│   ┌────────────────────────────────┐     │
│   │       ENTRAR A JUGAR           │     │
│   └────────────────────────────────┘     │
│                                          │
│   ¿Cómo se juega? ▾ (acordeón reglas)    │
└──────────────────────────────────────────┘
```

**Componentes:** `<NicknameForm />`, `<RulesAccordion />`

**Detalle UX:**
- El botón permanece deshabilitado hasta que el nickname sea válido (3–20 caracteres, sin espacios al inicio/final).
- Enter en el input equivale a presionar el botón.
- Al confirmar: `POST /api/session` → guarda `{ nickname, playerId, sessionToken }` en `sessionStorage` → redirige a P2.
- El acordeón de reglas es opcional pero recomendado: resuelve el onboarding sin agregar una pantalla de tutorial.

---

### P2 · Lobby de Salas

```
┌──────────────────────────────────────────────────────┐
│  [icon:bolt] Pokémon Duels   [icon:person] Diego  [Cambiar apodo]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────┐  ┌─────────────────────┐    │
│  │ + CREAR SALA (2P)   │  │ + CREAR SALA (4P)   │    │
│  └─────────────────────┘  └─────────────────────┘    │
│                                                      │
│  ┌──────────────────────────┐  ┌──────────────┐      │
│  │ Código de sala           │  │   UNIRSE     │      │
│  └──────────────────────────┘  └──────────────┘      │
│                                                      │
│  ── SALAS DISPONIBLES ────────────────  [icon:refresh Refrescar]│
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ [icon:sports_esports] Sala #A3F9        2/4 jugadores   [Unirse]  │  │
│  │    Ana, Luis                                   │  │
│  ├────────────────────────────────────────────────┤  │
│  │ [icon:sports_esports] Sala #B72K        1/2 jugadores   [Unirse]  │  │
│  │    Carla                                       │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  (vacío) No hay salas abiertas. ¡Crea la tuya!       │
└──────────────────────────────────────────────────────┘
```

**Componentes:** `<LobbyHeader />`, `<CreateRoomButtons />`, `<JoinByCodeForm />`, `<RoomList />` → `<RoomCard />`, `<EmptyState />`

**Detalle UX:**
- Cada `RoomCard` muestra código, ocupación (`2/4`) y los nicknames dentro. Ver quién está adentro ayuda a decidir.
- Las salas llenas o en curso no se listan (solo `status = waiting`).
- Polling cada ~5s o suscripción al canal de lobby. Botón manual de refrescar como respaldo.
- **Error a manejar:** si el nickname ya existe en esa sala, mostrar toast "Ese apodo ya está en uso en esta sala" y ofrecer cambiarlo.

---

### P3 · Selección de Equipo (Draft)

```
┌───────────────────────────────────────────────────────────┐
│  Sala #A3F9 · 4 jugadores  [icon:timer] Esperando a todos │
├───────────────────────────────────────────────────────────┤
│  PASO 1 — ELIGE TU INICIAL (exclusivo)                    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐              │
│  │[sprite]│ │[sprite]│ │[sprite]│ │[sprite]│              │
│  │Pikachu │ │Bulbasaur│ │Squirtle│ │Charmand.│             │
│  │Eléctric│ │ Planta │ │  Agua  │ │ Fuego  │              │
│  │  ✓ TÚ  │ │ TOMADO │ │        │ │        │              │
│  └────────┘ └────────┘ └────────┘ └────────┘              │
│              (Ana)      [CONFIRMAR INICIAL]               │
├───────────────────────────────────────────────────────────┤
│  PASO 2 — ELIGE 5 MÁS            Seleccionados: 3/5       │
│  ┌──────────────────┐  Tipo: [Todos ▾]                    │
│  │[icon:search] Buscar...│                               │
│  └──────────────────┘                                     │
│  ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐                     │
│  │#25 ││#94 ││#59 ││#131││#143││#065│  ... (grid scroll)  │
│  │ ✓  ││ ✓  ││ ✓  ││    ││    ││    │                     │
│  └────┘└────┘└────┘└────┘└────┘└────┘                     │
├───────────────────────────────────────────────────────────┤
│  TU EQUIPO: [Pika][—][—][—][—][—]      [ LISTO / READY ]  │
└───────────────────────────────────────────────────────────┘
```

**Componentes:** `<DraftScreen />`, `<StarterPicker />` → `<StarterCard />`, `<PokemonCatalog />` (`<SearchInput />`, `<TypeFilter />`, `<PokemonGrid />` → `<PokemonCard />`), `<TeamTray />`, `<ReadyButton />`

**Detalle UX — lo crítico de esta pantalla:**
- **Estados de una `StarterCard`:** `disponible` · `seleccionado por mí (✓ TÚ)` · `tomado por otro (gris + nickname)` · `pendiente de confirmación (spinner)`.
- El bloqueo se propaga por WebSocket (`room:state` → `startersTaken[]`). Si el servidor rechaza la elección (`team:starter_rejected`), mostrar toast **"Ana se lo llevó primero"** y devolver la tarjeta a estado tomado, sin perder el resto del progreso.
- El paso 2 permanece bloqueado visualmente hasta confirmar el inicial — refuerza la secuencia.
- `TeamTray` es persistente en la parte baja: siempre visible cuántos slots faltan.
- `ReadyButton` deshabilitado con tooltip explicativo ("Te faltan 2 pokémon") hasta completar 1+5.
- Tras marcar Ready, la pantalla pasa a modo lectura y muestra quién falta.
- **Búsqueda sin resultados:** si el filtro/buscador del catálogo no devuelve pokémon, `PokemonGrid` muestra un `<EmptyState />` ("No se encontraron pokémon") con botón para limpiar filtros.
- **Jugador desconectado en el draft:** su tarjeta de jugador se atenúa con badge "Desconectado" y un contador regresivo discreto; si no vuelve dentro de los 60s, desaparece de la lista y su starter reservado (si tenía) vuelve a estar disponible para el resto (RF-2.7).

---

### P4 · Sala de Espera / Bracket

```
┌──────────────────────────────────────────────────────┐
│  Sala #A3F9 · Torneo de 4                            │
├──────────────────────────────────────────────────────┤
│  JUGADORES                                           │
│  ┌──────────┐┌──────────┐┌──────────┐┌──────────┐    │
│  │ Diego    ││ Ana      ││ Luis     ││ Carla    │    │
│  │ Listo    ││ Listo    ││ Espera   ││ Listo    │    │
│  └──────────┘└──────────┘└──────────┘└──────────┘    │
├──────────────────────────────────────────────────────┤
│  BRACKET                                             │
│                                                      │
│   SEMIFINALES          FINAL                         │
│   ┌──────────┐                                       │
│   │ Diego    │──┐                                    │
│   │ Ana      │  │   ┌──────────┐                     │
│   └──────────┘  ├──►│    ?     │──► [icon:trophy] 1° / 2° │
│   ┌──────────┐  │   │    ?     │                     │
│   │ Luis     │──┘   └──────────┘                     │
│   │ Carla    │                                       │
│   └──────────┘      ┌──────────┐                     │
│                     │ 3ER PUESTO│──► 3° / 4°         │
│                     └──────────┘                     │
├──────────────────────────────────────────────────────┤
│         [ ENTRAR AL DUELO ]      [ Salir de sala ]   │
└──────────────────────────────────────────────────────┘
```

**Componentes:** `<WaitingRoom />`, `<PlayerStatusCard />`, `<TournamentBracket />` → `<BracketMatch />`, `<EnterDuelButton />`

**Detalle UX:**
- Para salas de 2, el bracket se reduce a una tarjeta de "Duelo Único".
- `EnterDuelButton` está deshabilitado hasta que el servidor emita el emparejamiento.
- **Esta pantalla se reutiliza entre rondas.** Al ganar la semifinal, el jugador vuelve aquí con el mensaje "Esperando el resultado de Luis vs Carla…". Sin esto, el ganador quedaría en una pantalla muerta.
- Los `BracketMatch` ya resueltos muestran ganador resaltado y perdedor atenuado.
- `PlayerStatusCard` acompaña "Listo"/"Espera" con `[icon:check_circle]`/`[icon:hourglass_empty]` respectivamente.

---

### P5 · Tablero de Duelo

```
┌────────────────────────────────────────────────────┐
│  Diego  vs  Ana                    Turno 4         │
├────────────────────────────────────────────────────┤
│                                    ┌─────────────┐ │
│                                    │[sprite]Gengar│ │
│                                    │Fantasma·Lv.50│ │
│                                    │ ███████░░░  │ │
│                                    │  70/100 HP  │ │
│                                    └─────────────┘ │
│                                                    │
│         [icon:timer] 07                            │
│         ┌──────────────┐                           │
│         │ Tu turno     │                           │
│         └──────────────┘                           │
│  ┌─────────────┐                                   │
│  │[sprite]Charizard│                               │
│  │ Fuego · Lv.50│                                  │
│  │ ████░░░░░░  │                                   │
│  │  45/100 HP  │                                   │
│  └─────────────┘                                   │
├────────────────────────────────────────────────────┤
│  ┌───────────────────┐ ┌───────────────────┐       │
│  │ Ataque Fuerte     │ │ Ataque Medio      │       │
│  │ 25 dmg · PP 2/4   │ │ 20 dmg · PP 4/4   │       │
│  └───────────────────┘ └───────────────────┘       │
│  ┌───────────────────┐ ┌───────────────────┐       │
│  │ Ataque Ligero     │ │ Ataque Básico     │       │
│  │ 15 dmg · PP 0/4 ✕ │ │ 10 dmg · PP ∞     │       │
│  └───────────────────┘ └───────────────────┘       │
│                                                    │
│  [ [icon:swap_horiz] CAMBIAR ]  [ [icon:flag] RENDIRSE ] │
├────────────────────────────────────────────────────┤
│  [icon:history] Charizard usó Ataque Fuerte. ¡Es muy eficaz! │
│     Gengar perdió 50 HP.                           │
└────────────────────────────────────────────────────┘
```

**Componentes:** `<BattleScreen />`, `<PokemonBattleCard />` (rival y propio, incluye nombre, tipo y `Lv.50` fijo — RF-7.8), `<HealthBar />`, `<TurnTimer />`, `<MoveButton />` ×4, `<SwitchButton />`, `<SurrenderButton />` (RF-5.5/RF-7.7, abre `<ConfirmDialog />` antes de emitir `duel:surrender`), `<BattleLog />`

**Detalle UX — lo crítico de esta pantalla:**
- **`HealthBar`** con color por umbral: verde (>50%), ámbar (20–50%), rojo (<20%). Animar la transición del daño, no saltar de golpe.
- **`TurnTimer`**: círculo o barra en cuenta regresiva desde 10. A los 3 segundos, cambia a rojo y vibra (móvil). Al llegar a 0, la UI muestra "Sin tiempo — atacaste con Ataque Básico".
- **`MoveButton` deshabilitado** cuando `PP = 0`, con el estilo tachado. El 4° nunca se deshabilita.
- **Importante — el daño mostrado es base, no final.** El botón dice "25 dmg" pero el daño real depende de la efectividad de tipo. Dos opciones:
  - *(Recomendada)* Mostrar un badge de efectividad en el botón contra el rival actual: `25 dmg → ×2 [icon:bolt]`. Requiere consultar la matriz de tipos en el cliente (ya está expuesta vía `/api/type-effectiveness`), pero es solo informativo — el cálculo real sigue en servidor.
  - Mostrar solo el base y dejar que el jugador deduzca. Más simple, pero castiga a quien no conoce la tabla de tipos.
- **Estado de espera:** tras elegir ataque, los botones se bloquean y aparece "Esperando a Ana…". Esto hace visible la simultaneidad sin revelar la elección del rival.
- **`BattleLog`**: 2–3 líneas visibles con scroll. Es el único lugar donde el jugador entiende *por qué* pasó lo que pasó (efectividad, orden de turno aleatorio, timeouts).
- **`SurrenderButton`**: siempre visible, pero abre un `<ConfirmDialog />` ("¿Rendirte? Perderás este duelo") antes de emitir `duel:surrender` — evita un clic accidental que le regale la victoria al rival (RF-5.5).

---

## 4. Modales

### Modal A · Cambio de Pokémon

```
┌────────────────────────────────────────────┐
│  ELIGE TU POKÉMON              [icon:close] │
│  [icon:warning] Charizard quedó fuera de combate │
├────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Charizard│ │  Gyarados│ │  Snorlax │    │
│  │[icon:skull] K.O.│ │ ███░ 60  │ │ ████ 100 │ │
│  │[No dispon]│ │ [ENVIAR] │ │ [ENVIAR] │   │
│  └──────────┘ └──────────┘ └──────────┘    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │  Alakazam│ │  Lapras  │ │ Machamp  │    │
│  │ ██░░ 35  │ │ ████ 100 │ │[icon:skull] K.O.│ │
│  │ [ENVIAR] │ │ [ENVIAR] │ │[No dispon]│   │
│  └──────────┘ └──────────┘ └──────────┘    │
├────────────────────────────────────────────┤
│              [ CANCELAR ]                  │
│      (oculto si el cambio es forzado)      │
└────────────────────────────────────────────┘
```

**Componentes:** `<SwitchModal />`, `<TeamMemberCard />`

**Detalle UX:**
- **Dos modos:** `forzado` (tras K.O. — sin botón cancelar, sin ícono de cerrar, no se puede cerrar) y `voluntario` (con cancelar).
- El pokémon actualmente en campo aparece con badge "En campo" y botón deshabilitado.
- Los K.O. se muestran atenuados con badge `[icon:skull]`, pero **no se ocultan** — el jugador necesita ver el desgaste de su equipo completo.
- En modo forzado, el timer de 10s sigue corriendo. Si expira sin elegir, el servidor envía automáticamente el primer pokémon vivo por orden de slot (ver TECH-DESIGN §6).

---

### Modal B · Ranking Final

```
┌────────────────────────────────────────────┐
│      [icon:trophy] TORNEO FINALIZADO        │
├────────────────────────────────────────────┤
│                    ┌────┐                  │
│                    │ 1° │                  │
│           ┌────┐   │Ana │                  │
│           │ 2° │   │    │  ┌────┐          │
│           │Diego│  │    │  │ 3° │          │
│           │    │   │    │  │Luis│          │
│           └────┘   └────┘  └────┘          │
│                                            │
│           4° puesto — Carla                │
├────────────────────────────────────────────┤
│          [ VOLVER AL LOBBY ]               │
└────────────────────────────────────────────┘
```

**Componentes:** `<FinalRankingModal />`, `<Podium />`, `<RankingList />`

**Detalle UX:**
- Para salas de 2, el podio se simplifica a ganador/perdedor.
- "Volver al Lobby" limpia el estado de sala pero **conserva el nickname** en sesión — el jugador no debe volver a escribirlo.

---

### Estado especial · Sala interrumpida

No es una pantalla nueva, sino un mensaje que puede aparecer sobre P2/P3/P4/P5 cuando el cliente
recibe `room:aborted` (ADR-0008: el backend se reinició con esa sala en curso).

```
┌────────────────────────────────────────────┐
│  [icon:warning] PARTIDA INTERRUMPIDA        │
│  Hubo un problema del servidor y la partida │
│  no pudo continuar. Volvé a intentarlo.     │
├────────────────────────────────────────────┤
│            [ VOLVER AL LOBBY ]              │
└────────────────────────────────────────────┘
```

**Componentes:** `<RoomAbortedModal />`, no ofrece reintentar el mismo duelo — solo volver a P2.

---

## 5. Estructura de componentes (React)

```
src/
├── App.jsx                       # Router + provider de sesión
├── context/
│   ├── SessionContext.jsx        # nickname, playerId, sessionToken
│   └── SocketContext.jsx         # conexión WS + suscripciones
├── screens/
│   ├── P1_Nickname.jsx
│   ├── P2_Lobby.jsx
│   ├── P3_Draft.jsx
│   ├── P4_WaitingRoom.jsx
│   └── P5_Battle.jsx
├── components/
│   ├── lobby/
│   │   ├── RoomCard.jsx
│   │   ├── JoinByCodeForm.jsx
│   │   └── CreateRoomButtons.jsx
│   ├── draft/
│   │   ├── StarterCard.jsx
│   │   ├── PokemonCard.jsx
│   │   ├── PokemonGrid.jsx
│   │   ├── TypeFilter.jsx
│   │   └── TeamTray.jsx
│   ├── bracket/
│   │   ├── TournamentBracket.jsx
│   │   ├── BracketMatch.jsx
│   │   └── PlayerStatusCard.jsx
│   ├── battle/
│   │   ├── PokemonBattleCard.jsx
│   │   ├── HealthBar.jsx
│   │   ├── TurnTimer.jsx
│   │   ├── MoveButton.jsx
│   │   ├── SurrenderButton.jsx
│   │   └── BattleLog.jsx
│   ├── modals/
│   │   ├── SwitchModal.jsx
│   │   ├── FinalRankingModal.jsx
│   │   ├── ConfirmDialog.jsx      # usado por Rendirse
│   │   └── RoomAbortedModal.jsx
│   └── ui/
│       ├── Button.jsx
│       ├── Toast.jsx
│       ├── Badge.jsx
│       └── EmptyState.jsx
├── hooks/
│   ├── useSocket.js
│   ├── useTurnTimer.js
│   └── useTypeEffectiveness.js
└── lib/
    ├── api.js                    # llamadas REST
    └── typeColors.js             # mapa tipo → color Tailwind
```

## 6. Sistema visual

Implementado en `DESIGN.md` + `Prototipos/assets/pokeduels-design-system.css` (ver nota al inicio
de este documento) — acá solo lo que es específico de UX, no una redescripción del sistema visual:

**Colores por tipo:** cada tipo tiene un color fijo (paleta clásica de Pokémon, tokens
`--pd-type-*` en el CSS compartido, clases `.pd-badge--{tipo}`), usado consistentemente en badges
de tipo, bordes de tarjeta y filtros. Es el principal recurso de reconocimiento rápido en el draft
y en combate.

**Jerarquía tipográfica:** títulos y logo en Archivo (clases `.pd-title`/`.pd-logo`), HP/PP/timers/
labels en Space Mono monoespaciado (`.pd-stat`/`.pd-label`/`.pd-meta`) para que los números no
bailen al cambiar — ver `useTypeEffectiveness`-adjacent hook y `lib/typeColors.js` en la
estructura de componentes (§5) para la implementación real en React.

**Estados obligatorios en cada componente interactivo:** `default` · `hover` · `disabled` (con razón visible) · `loading/pending` · `error`.

**Feedback de efectividad en combate:**
- Muy eficaz (×2): destello + texto "¡Es muy eficaz!" en el log
- Poco eficaz (×0.5): impacto atenuado + "No es muy eficaz…"
- Neutral (×1): impacto estándar sin texto adicional

## 7. Responsive

| Breakpoint | Adaptación |
|---|---|
| **Móvil (<640px)** | Arena de combate apilada verticalmente; ataques en grid 2×2 a ancho completo; bracket con scroll horizontal; catálogo en grid de 3 columnas |
| **Tablet (640–1024px)** | Catálogo en 5 columnas; bracket completo visible |
| **Desktop (>1024px)** | Arena con rival arriba-derecha y propio abajo-izquierda (diagonal clásica); catálogo en 8 columnas |

## 8. Decisiones (UX)

Ninguna quedaba realmente abierta — cada una ya tenía una recomendación clara y ninguna se
contradice con PRD.md ni TECH-DESIGN.md, así que se cierran acá formalmente.

| # | Pregunta | Resolución |
|---|---|---|
| 1 | ¿Mostrar el multiplicador de efectividad en los botones de ataque? | **Cerrado:** sí — coherente con que TECH-DESIGN expone `GET /api/type-effectiveness` específicamente "para hints en UI" |
| 2 | ¿Qué pasa si expira el timer durante un cambio forzado? | **Cerrado:** primer pokémon vivo por orden de slot (TECH-DESIGN §6) |
| 3 | ¿Se muestra el equipo completo del rival o solo su pokémon activo? | **Cerrado:** solo el activo en v1; equipo completo queda para una mejora futura |
| 4 | ¿Hay animaciones de ataque o solo cambios de barra? | **Cerrado:** solo barras + log en v1; animaciones de sprite quedan para pulido |

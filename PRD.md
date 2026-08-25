---
title: "Pokémon Duels"
---

# PRD: Pokémon Duels (v1)

**Versión:** 1.0 (MVP)
**Estado:** Listo para diseño técnico
**Autor:** Diego

---

## Problema

Juego web multijugador en tiempo real donde 2 o 4 jugadores arman un equipo de 6 pokémon y se
enfrentan en duelos 1v1 por turnos, con un sistema de combate simplificado basado en daño
proporcional y ventajas de tipo.

Los juegos de combate Pokémon existentes (Pokémon Showdown y similares) son extremadamente
completos pero también extremadamente complejos: cientos de especies, stats individuales,
EVs/IVs, naturalezas, habilidades, objetos, estados alterados y una curva de aprendizaje alta. No
existe una versión ligera, jugable en 5 minutos desde el navegador, sin instalación ni
conocimiento previo del metajuego.

**Oportunidad:** construir un duelo por turnos que cualquiera entienda en 30 segundos, con
partidas cortas, reglas explicables en una pantalla y despliegue web inmediato. El objetivo es
entregar una experiencia reconocible del combate clásico de Pokémon, reducida a su núcleo
jugable, desplegable rápidamente y sin infraestructura compleja.

## Usuario objetivo

| Persona | Descripción | Necesidad principal |
|---|---|---|
| **Jugador casual nostálgico** | Conoce Pokémon de Game Boy, no juega competitivo | Revivir la mecánica clásica sin complejidad |
| **Grupo de amigos** | 2–4 personas que quieren una partida rápida juntos | Crear sala, jugar, ver quién gana |
| **Curioso/primerizo** | No conoce Pokémon en profundidad | Reglas simples y feedback visual claro |

## Objetivo / resultado esperado

Si el producto funciona como se espera, un jugador nuevo pasa de "no conocer el juego" a
"terminar un duelo" en minutos, sin fricción de cuentas ni curva de aprendizaje:

- **O1.** Un jugador nuevo entra, arma equipo y completa un duelo sin leer instrucciones externas.
- **O2.** Una partida completa (torneo de 4 jugadores) dura menos de 15 minutos.
- **O3.** El resultado del combate lo deciden las elecciones del jugador (tipo y ataque elegido),
  no el azar puro — el orden de ataque dentro de una ronda es aleatorio (RF-4.7), pero no lo es
  quién elige mejor.

<!-- REVISAR: los objetivos técnicos "desplegable en tiers gratuitos" y "motor autoritativo en
servidor" del draft original ya están cubiertos como criterios verificables en RNF-3 y RNF-4 más
abajo — se consolidaron ahí para no duplicar el mismo objetivo en dos secciones. -->

## Alcance (qué sí incluye esta versión)

### Flujo de usuario (pantallas)

La aplicación consta de **5 pantallas y 2 modales**. El detalle de componentes y wireframes está
en `UX-DESIGN.md`.

1. **P1 · Ingreso rápido** → el jugador escribe su nickname y entra. Sin registro ni contraseña.
2. **P2 · Lobby de salas** → ve salas disponibles, se une con código, o crea sala de 2 o 4 jugadores.
3. **P3 · Selección de equipo (draft):**
   - Elige 1 pokémon inicial entre Pikachu, Bulbasaur, Squirtle y Charmander. Los ya tomados por
     otros jugadores aparecen bloqueados en tiempo real.
   - Elige 5 pokémon adicionales del catálogo de 50 (con buscador y filtro por tipo).
   - Marca "Ready" (habilitado solo con el equipo completo).
4. **P4 · Sala de espera / Bracket** → ve el estado de los demás jugadores y el árbol del torneo.
   Entra al duelo cuando el servidor lo indica.
5. **P5 · Tablero de duelo** → combate en vivo: barras de vida, 4 botones de ataque con PP,
   temporizador de 10s y botón de cambio de pokémon.
   - **Modal A · Cambio de pokémon:** grid del equipo con HP restante y badges de K.O. Obligatorio
     tras un K.O., opcional en el resto de casos.
   - Al terminar un duelo, si el torneo continúa, el jugador vuelve a **P4** a esperar la
     siguiente ronda.
6. **Modal B · Ranking final** → podio con las posiciones (1° a 4°), y retorno al lobby (P2).

### Requisitos funcionales

**RF-1 · Identidad del jugador (sin auth tradicional)**
- RF-1.1 El usuario ingresa únicamente un **nickname** para entrar a jugar. No hay registro con correo ni contraseña.
- RF-1.2 El nickname se guarda en la sesión del navegador y se usa como identidad durante toda la partida.
- RF-1.3 El usuario puede cambiar su nickname volviendo a la pantalla de ingreso desde el lobby.
- RF-1.4 El nickname debe ser único dentro de una misma sala (no puede haber dos "Diego" en la misma partida).
- RF-1.5 No hay persistencia de cuenta: cerrar el navegador implica perder la identidad.

**RF-2 · Salas y lobby**
- RF-2.1 Un usuario puede crear una sala especificando 2 o 4 jugadores.
- RF-2.2 Un usuario puede ver la lista de salas en estado `waiting`, con su capacidad y ocupación actual.
- RF-2.3 Un usuario puede unirse a una sala mediante un **código corto**.
- RF-2.4 Una sala no acepta más jugadores que su `max_players`.
- RF-2.5 La partida solo inicia cuando **todos** los jugadores de la sala marcan "Ready" y la sala está completa.
- RF-2.6 Un jugador puede salir de la sala antes del inicio; al hacerlo libera su inicial reservado.
- RF-2.7 Si un jugador se desconecta durante el lobby o el draft y no reconecta dentro de 60 segundos, el servidor lo remueve de la sala, libera su inicial reservado (si lo tenía) y notifica al resto de los jugadores.

**RF-3 · Selección de equipo**
- RF-3.1 Cada jugador elige exactamente 1 pokémon inicial de los 4 clásicos.
- RF-3.2 **Exclusividad:** un inicial ya tomado por otro jugador de la sala no está disponible; el primero en confirmar se lo reserva.
- RF-3.3 Cada jugador elige 5 pokémon adicionales del catálogo de 50.
- RF-3.4 El equipo final es de exactamente 6 pokémon.
- RF-3.5 Todos los pokémon parten en igualdad de condiciones (mismo HP base, mismo nivel).

**RF-4 · Motor de combate**
- RF-4.1 Todos los pokémon tienen HP base 100.
- RF-4.2 Cada pokémon tiene 4 ataques con daño 25 / 20 / 15 / 10 (25%, 20%, 15%, 10% del HP base).
- RF-4.3 Los tres ataques más fuertes tienen 4 usos (PP); el más débil tiene usos ilimitados.
- RF-4.4 Todos los ataques heredan el tipo del pokémon que los usa.
- RF-4.5 Ventaja de tipo: daño ×2. Desventaja: daño ×0.5 (redondeo hacia abajo, mínimo 1). Neutral: ×1.
- RF-4.6 No existen inmunidades (ningún matchup produce 0 daño).
- RF-4.7 El orden de ataque dentro de cada ronda es aleatorio.
- RF-4.8 Si un pokémon queda K.O. por el primer ataque de la ronda, no llega a atacar.
- RF-4.9 Un pokémon que entra al campo (por K.O. o cambio) puede atacar en esa misma ronda.
- RF-4.10 El cambio de pokémon es voluntario; se ofrece al inicio del duelo y tras cada K.O./intercambio relevante.
- RF-4.11 Secuencia de ronda: primero se revelan los cambios (ambos jugadores ven qué pokémon está en campo), después ambos eligen ataque a ciegas.
- RF-4.12 Todo el cálculo de combate ocurre en el servidor; el cliente solo envía intenciones y renderiza resultados.

**RF-5 · Fin de duelo y torneo**
- RF-5.1 Un jugador pierde el duelo cuando sus 6 pokémon están K.O.
- RF-5.2 Con 2 jugadores: un solo duelo, el ganador es el campeón.
- RF-5.3 Con 4 jugadores: 2 duelos aleatorios en ronda 1 → ganadores entre sí (1°/2°) y perdedores entre sí (3°/4°).
- RF-5.4 Al cerrar el torneo se muestra el ranking final con todas las posiciones.
- RF-5.5 Un jugador puede rendirse voluntariamente en cualquier momento del duelo; el rival gana automáticamente, igual que en una desconexión (RF-6.2).

**RF-6 · Tiempo real y resiliencia**
- RF-6.1 Si un jugador no elige acción en 10 segundos, el sistema ataca automáticamente con su ataque más débil.
- RF-6.2 Si un jugador se desconecta durante un duelo, se notifica al rival y este gana automáticamente ese duelo.
- RF-6.3 Los cambios de estado del duelo se propagan a ambos jugadores en tiempo real.

**RF-7 · Interfaz y feedback visual**
- RF-7.1 Durante el combate se muestra la barra de vida de ambos pokémon con valor absoluto (x/100 HP) y porcentaje.
- RF-7.2 Cada botón de ataque muestra su daño base y sus PP restantes (el 4° indica PP ilimitado).
- RF-7.3 Se muestra un temporizador visual en cuenta regresiva de 10 segundos por turno.
- RF-7.4 En la selección de inicial, los pokémon ya reservados por otros jugadores se muestran deshabilitados y marcados como "Tomado" en tiempo real.
- RF-7.5 El catálogo de 50 pokémon cuenta con buscador y filtro por tipo.
- RF-7.6 Al cerrar el torneo se muestra un podio con las posiciones finales.
- RF-7.7 Durante el combate se muestra un botón de "Rendirse" que pide confirmación antes de aplicar RF-5.5.
- RF-7.8 Cada pokémon muestra un nivel fijo (Lv.50) en el tablero de duelo. Es un valor constante igual para todos (consistente con RF-3.5, "mismo nivel"); no sube ni se persiste — no es progresión de nivel (fuera de alcance, sección "No alcance").

### Requisitos no funcionales

| ID | Requisito | Criterio |
|---|---|---|
| RNF-1 | Latencia de resolución de turno | < 500 ms percibidos |
| RNF-2 | Desktop-only | Funcional en desktop. Sin soporte móvil (decisión explícita, 2026-08-25 — ver "No alcance") |
| RNF-3 | Seguridad del motor | Ningún cálculo de daño en cliente |
| RNF-4 | Costo de despliegue | Compatible con tiers gratuitos de Vercel/Render/Neon |
| RNF-5 | Sprites | Consumidos desde PokeAPI, no almacenados localmente |
| RNF-6 | Disponibilidad | Aceptable el cold start de Render en tier gratuito |

## No alcance (qué explícitamente no incluye esta versión)

Excluido deliberadamente para mantener el alcance acotado:

- Soporte móvil/tablet — el juego es desktop-only (decisión explícita, 2026-08-25, corrige RNF-2 v1.0 que pedía "funcional en móvil y desktop"; sin ese requisito, no hace falta layout responsive)
- Fidelidad competitiva al metajuego real de Pokémon (EVs/IVs, naturalezas, habilidades)
- Precisión / probabilidad de fallar un ataque
- Golpes críticos
- Estados alterados (veneno, parálisis, sueño, quemadura, congelación, confusión)
- Modificadores de estadísticas en combate
- Tipos duales por pokémon
- Inmunidades de tipo
- Progresión de nivel, experiencia o evolución
- Objetos/ítems de combate
- Velocidad como stat determinante del turno (se usa aleatoriedad)
- Salas de 3, 5+ jugadores (solo se soportan salas de 2 o 4)
- Chat entre jugadores
- Espectadores
- Ranking global persistente / ELO / monetización
- **Cuentas de usuario persistentes** (registro, contraseña, recuperación)
- **Historial de partidas pasadas** (no hay pantalla de historial en v1)

## Criterios de éxito

| Métrica | Objetivo |
|---|---|
| Tasa de finalización de partida | > 70% de duelos iniciados terminan sin abandono |
| Duración media de un duelo 1v1 | 3–6 minutos |
| Tiempo de onboarding (nickname → primer ataque) | < 2 minutos |
| Turnos resueltos sin timeout | > 85% |

## Casos borde a contemplar

- Un jugador no elige acción en su turno (10s) → auto-ataque con el movimiento más débil (RF-6.1).
- Un jugador se desconecta **durante un duelo activo** → el rival gana automáticamente ese duelo (RF-6.2); no hay reconexión mid-duelo en v1.
- Un jugador se desconecta o refresca **antes del duelo** (lobby/draft) → reconecta vía `sessionStorage` y conserva su inicial reservado, siempre que vuelva dentro de los 60 segundos.
- Un jugador se desconecta en lobby/draft y **no vuelve** dentro de 60 segundos → el servidor lo remueve de la sala, libera su inicial reservado y el resto puede seguir sin quedar bloqueado (RF-2.7).
- Dos jugadores intentan reservar el mismo pokémon inicial al mismo tiempo → gana el primero en confirmar; el segundo debe elegir otro (RF-3.2).
- Un jugador intenta unirse a una sala ya llena → la unión es rechazada (RF-2.4).
- Un jugador sale de la sala antes de que empiece la partida → libera su inicial reservado (RF-2.6).
- Dos jugadores de la misma sala eligen el mismo nickname → se rechaza al segundo, debe cambiarlo (RF-1.4).
- Un cambio de pokémon forzado (post-K.O.) expira sin elegir → el servidor asigna automáticamente el primer pokémon vivo por orden de slot (ver TECH-DESIGN §6).
- Todos los pokémon de un jugador quedan K.O. → pierde el duelo (RF-5.1); si el torneo continúa, vuelve a P4 a esperar la siguiente ronda.
- La búsqueda/filtro del catálogo de 50 no devuelve resultados → se muestra un estado vacío ("No se encontraron pokémon") con acción para limpiar filtros.
- El servidor se reinicia mientras un torneo tiene un duelo en curso → se anula todo el torneo de esa sala (no solo el duelo interrumpido); al reconectar, los jugadores ven un mensaje de partida interrumpida y vuelven al lobby (ver TECH-DESIGN ADR-0008).

## Supuestos y riesgos abiertos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Cold start de Render corta la conexión WebSocket | Alto | Health check periódico externo (cron dedicado tipo cron-job.org/UptimeRobot cada 10-14 min contra `/health`; GitHub Actions se descartó por desactivarse a los 60 días sin actividad en el repo — ver TECH-DESIGN ADR-0006) |
| Desbalance: pokémon de tipos con muchas ventajas dominan | Medio | Curar el catálogo de 50 con distribución equilibrada de tipos |
| Abandono en torneos de 4 (esperar a otros duelos) | Medio | Mostrar el duelo paralelo o un estado de espera claro |
| PokeAPI caída o rate-limited | Bajo | Cachear los 50 sprites/datos en la propia BD al hacer seed |
| Condición de carrera al elegir inicial | Medio | Constraint único en BD + confirmación autoritativa del servidor |
| **Identidad frágil sin auth**: refrescar el navegador antes de empezar el duelo puede perder la sesión y sacar al jugador de la sala | Alto | Guardar nickname + `roomId` en `sessionStorage` para reconectar en lobby/draft. Durante un duelo activo la desconexión no se recupera: el rival gana automáticamente (ver RF-6.2) |
| **Nickname duplicado en la misma sala** genera confusión de identidad | Medio | Validar unicidad de nickname por sala al unirse |
| **Suplantación**: sin auth, alguien podría enviar acciones a nombre de otro | Medio | Token de sesión efímero emitido por el servidor al ingresar el nickname; se valida en cada evento |

**Dependencias abiertas:**
- [ ] Definir la lista final de los 50 pokémon del catálogo con su tipo único asignado.
- [ ] Definir la matriz de efectividad de tipos a implementar (subset o tabla completa de 18).

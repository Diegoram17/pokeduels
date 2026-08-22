# Especificación de Juego de Duelos tipo Pokémon (v1 simplificada)

> Documento de referencia para que una IA (o desarrollador) implemente el motor de juego y las reglas de negocio. Todas las reglas aquí son definitivas para esta versión (v1). Cualquier mecánica no listada se considera **fuera de alcance**.

---

## 1. Alcance del catálogo

- **50 pokémon** disponibles en total, seleccionados por ser los más conocidos/populares, cubriendo idealmente los **18 tipos** existentes.
- Cada pokémon tiene **un solo tipo** (sin tipos duales, para simplificar).
- Todos los pokémon parten del **mismo nivel** (no hay progresión de nivel ni experiencia).
- Los datos base (nombre, sprite, tipo) se obtienen de **PokeAPI**; los valores de combate (HP, daño, PP) son fijos y definidos por este documento, no por las stats reales de PokeAPI.

## 2. Selección de equipo

- Cada jugador elige **1 pokémon inicial** de un pool de **4 clásicos fijos**:
  - **Pikachu**
  - **Bulbasaur**
  - **Squirtle**
  - **Charmander**
- **Regla de exclusividad**: un mismo pokémon inicial **no puede repetirse entre jugadores** de la misma sala. El primero en confirmar su elección se lo "reserva"; a los demás jugadores solo les quedan disponibles los iniciales restantes.
  - Como el tamaño máximo de sala es **4 jugadores** (ver sección 4) y hay exactamente **4 iniciales**, en el peor caso (sala llena) cada jugador termina con un inicial distinto y no sobra ninguno.
  - Implementación sugerida: la selección de inicial debe manejarse como un **recurso bloqueado en tiempo real** (ej. lock optimista o "primero en confirmar, se lo lleva"), para evitar que dos jugadores tomen el mismo pokémon por una condición de carrera si eligen casi al mismo tiempo. Si un jugador intenta confirmar un inicial que ya fue tomado, el sistema debe rechazar la elección y forzarlo a elegir entre los que sigan disponibles.
- Luego elige **5 pokémon adicionales** del catálogo de 50 → equipo final de **6 pokémon**.
- La partida arranca cuando **todos los jugadores presionan "Ready"**.
- El número de jugadores en una sala debe ser válido según el modo de torneo (ver sección 7): **2 o 4 jugadores**.

## 3. Combate por turnos

### 3.1 HP
- El diseño de daño es **proporcional**, no valores fijos arbitrarios.
- Se establece un **HP base = 100** para todos los pokémon (mismo valor para todos; no hay stats individuales de vida por especie).
- El daño de cada ataque se define como **% de ese HP base**, así la relación "más fuerte vs. más débil" se mantiene igual sin importar si más adelante se decide escalar el HP base (ej. subir a 200 manteniendo los mismos porcentajes).

### 3.2 Ataques
- Cada pokémon tiene **4 ataques fijos**, con daño proporcional al HP base (100):

  | Ataque | Daño (neutral) | % del HP base | Usos (PP) |
  |---|---|---|---|
  | Más fuerte | 25 | 25% (1/4 de la vida) | 4 usos |
  | Segundo | 20 | 20% | 4 usos |
  | Tercero | 15 | 15% | 4 usos |
  | Más débil | 10 | 10% | **ilimitado** (sin límite de uso) |

  > **Ejemplo de referencia del diseño:** el ataque más fuerte de un pokémon, usado contra un rival **neutral** (sin ventaja ni desventaja de tipo), le quita **1/4 de su vida** (25 de 100). Si ese mismo ataque se usa contra un tipo **débil por naturaleza**, el daño se **duplica**: 50 de 100, es decir, la **mitad** de la vida total del rival.

- Todos los ataques de un pokémon **heredan su tipo** (ej. todos los ataques de un pokémon de tipo Fuego son de tipo Fuego).
- Si un pokémon se queda sin PP en sus 3 ataques con límite, **siempre puede seguir usando el ataque más débil** (nunca se queda sin opciones).

### 3.3 Efectividad de tipo
- **Ventaja de tipo** (ej. Agua vs Fuego): daño **x2**.
- **Desventaja de tipo** (ej. Fuego vs Agua): daño **x0.5**, redondeado **hacia abajo, mínimo 1** (nunca hace 0 daño). Ej: el ataque "Tercero" (15) con desventaja quedaría en 7.5 → se redondea a **7**.
- **Neutral**: daño **x1**.
- No existen inmunidades (multiplicador x0); toda combinación de tipos hace daño.
- Tabla de tipos: se debe definir la matriz de fortalezas/debilidades para los tipos presentes en los 50 pokémon elegidos (no hace falta la tabla completa de 18x18 si no todos los tipos están representados, pero se recomienda cubrirla completa por si se amplía el catálogo luego).

### 3.4 Orden de turno
- El orden de ataque en cada turno es **aleatorio** (no depende de velocidad ni stats).
- **Si un pokémon queda K.O. por el primer ataque del turno, el segundo pokémon NO llega a atacar ese turno** (su turno se cancela, ya que está fuera de combate).
- **Cuando un pokémon nuevo entra al campo** (ya sea por K.O. del anterior o por cambio voluntario), **no pierde turno**: puede atacar en la misma ronda en la que entra. No existe una ronda "gratis" solo para cambiar; el pokémon que entra participa normalmente en el orden aleatorio de ataque de esa ronda.

### 3.5 Cambio de pokémon
- El cambio de pokémon es **siempre voluntario**, nunca automático.
- Ocurre en dos momentos:
  1. **Al iniciar el duelio contra un nuevo rival**: se pregunta qué pokémon mandar primero.
  2. **Cada vez que un pokémon gana o pierde un intercambio** (es decir, tras cada resultado de turno relevante — especialmente cuando un pokémon queda K.O.): se pregunta si quiere **cambiar de pokémon o mantener el actual**.
- **Resolución de un turno completo**:
  1. Si alguno de los dos jugadores decide cambiar de pokémon, el cambio se revela primero (ambos ven qué pokémon está en el campo).
  2. Luego, **ambos jugadores eligen su ataque simultáneamente** (a ciegas entre sí, sin ver el ataque elegido por el rival).
  3. Se resuelve el orden de ataque de forma aleatoria (ver 3.4).
  4. *(Confirmado: esta secuencia replica el comportamiento del juego original — primero se revelan los cambios de pokémon, y solo después se eligen los ataques.)*

### 3.6 Fin de un duelo 1 vs 1
- Un jugador pierde el enfrentamiento completo cuando **los 6 pokémon de su equipo han quedado K.O.** (no le queda ninguno disponible para enviar).
- El otro jugador es el ganador del duelo.

## 4. Estructura de torneo

- Tamaños de sala soportados: **2 o 4 jugadores**.
- **Si son 2 jugadores**: un solo duelo 1v1; el ganador es automáticamente el campeón.
- **Si son 4 jugadores**:
  1. Se emparejan aleatoriamente en **2 duelos 1v1** (ronda 1).
  2. **Ganadores entre sí** → definen el puesto 1° y 2°.
  3. **Perdedores entre sí** → definen el puesto 3° y 4°.
  4. Al final se muestra un **ranking final con los 4 puestos**.

## 5. Reglas de tiempo / conexión (multiplayer online)

- **Timeout por inactividad**: si un jugador no elige acción (ataque o cambio de pokémon) en **10 segundos**, el sistema **ataca automáticamente con el ataque más débil** en su nombre.
- **Desconexión**: si un jugador se desconecta durante un duelo, se notifica al rival que su oponente se desconectó y **se le otorga la victoria automática** de ese duelo.

## 6. Exclusiones explícitas (fuera de alcance en v1)

Estas mecánicas del juego original **NO** se implementan en esta versión:
- Precisión / probabilidad de fallar un ataque.
- Golpes críticos.
- Estados alterados (veneno, parálisis, sueño, quemadura, congelación, confusión).
- Modificadores de estadísticas en combate (subir/bajar ataque, defensa, velocidad, etc.).
- Tipos duales por pokémon.
- Inmunidades de tipo (multiplicador x0).
- Progresión de nivel, experiencia o evolución.
- Objetos/ítems de combate (pociones, revivir, etc.).
- Velocidad como stat que determina el orden de turno (se usa aleatoriedad en su lugar).

## 7. Pendientes de definición antes de implementar

- Lista concreta de los **50 pokémon** del catálogo y su tipo asignado (uno solo por pokémon). Criterio acordado: los **más populares/representativos**, buscando cubrir la mayor cantidad posible de los 18 tipos. *(Pendiente — se define en un siguiente paso.)*
- Matriz de efectividad de tipos a usar (subset o tabla completa de 18 tipos).

## 8. Arquitectura técnica

> El detalle técnico completo (modelo de datos, contratos de API, eventos WebSocket, casos borde y plan de fases) vive en **`TECH-DESIGN-pokemon-duels.md`**. El detalle de pantallas y componentes vive en **`UX-DESIGN-pokemon-duels.md`**. Este documento se mantiene como la fuente de verdad de las **reglas de juego** únicamente.

Resumen del stack:
- **Frontend:** React + Tailwind CSS, desplegado en Vercel. 5 pantallas + 2 modales.
- **Backend:** Node.js + Express (REST) + WebSocket, desplegado en Render. El motor de combate es autoritativo en servidor.
- **Base de datos:** PostgreSQL en Neon.
- **Sprites:** consumidos desde PokeAPI, cacheados en el seed del catálogo.
- **Identidad:** sin registro ni contraseña — solo nickname + token de sesión efímero.

---

**Resumen de constantes clave:**
- HP base por pokémon: `100`
- Daño de ataques (neutral): `[25, 20, 15, 10]` → 25%, 20%, 15%, 10% del HP base (el de daño 10 tiene PP ilimitado; los otros 3 tienen 4 usos cada uno)
- Multiplicador ventaja de tipo: `x2` (ej. ataque más fuerte con ventaja = 50, mitad del HP base)
- Multiplicador desventaja de tipo: `x0.5`, redondeado hacia abajo, **mínimo 1** de daño
- El pokémon que entra al campo (por KO o cambio) **ataca en la misma ronda**, no pierde turno
- Timeout de turno: `10s` → auto-ataque con el movimiento más débil
- Tamaño de equipo: `6 pokémon` (1 inicial + 5 elegidos)
- Tamaños de torneo soportados: `2` o `4` jugadores

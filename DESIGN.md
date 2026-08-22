# Poke-duels — Arcade Battle Arena

## North Star: "El Estadio Encendido"
Una pantalla de combate que se siente como el momento previo al duelo. Arte a sangre completa, interfaz mínima flotando encima, y un solo camino claro: entrar a jugar.

## Colors
- **Rojo Poké (`#ee1515`, sombra `#b3070a`):** acción primaria únicamente — el botón "Entrar a jugar" y el emblema de pokébola.
- **Amarillo rayo (`#ffcb05`):** acento de marca. Logo, etiquetas de campo (`Nickname`), borde del botón primario y estados focus/hover. Nunca como fondo grande.
- **Azul arena (`#2a75bb` / `#5aaaff` al 26-35%):** bordes, rejilla de perspectiva y glow frío del lado derecho.
- **Fondo (`#04070f` → `#16255c`):** noche de estadio. El degradado radial nace en el centro del arte.
- **Texto:** blanco puro para títulos, `rgba(220,230,255,.72)` para cuerpo, `rgba(206,220,255,.65)` para metadatos.
- **Regla de tres:** rojo = acción, amarillo = marca, azul = estructura. Ningún elemento mezcla los tres roles.

## Background & Legibility
- El arte de la arena ocupa el 100% del lienzo (`<image-slot>` reemplazable, `fit: cover`).
- Nunca poner texto sobre el arte sin scrim. Dos capas fijas, ambas `pointer-events:none`:
  - **Scrim vertical:** oscurece cielo y suelo, deja el centro limpio.
  - **Scrim diagonal (100deg):** oscurece los bordes izquierdo y derecho al 88-92%, con una ventana transparente en el centro para que los Pokémon en duelo se vean completos.
- Efectos propios encima del arte: conic de energía en rotación lenta, emblema de pokébola al 13%, rejilla en perspectiva y viñeta. Todos sutiles — el arte manda.

## Typography
- **Display:** Archivo 900 italic, uppercase, `letter-spacing: -.035em`. Solo el logo.
- **Títulos:** Archivo 800.
- **Cuerpo:** Archivo 400, `line-height 1.6`, `text-wrap: pretty`.
- **Etiquetas, HUD y datos:** Space Mono 700, uppercase, `letter-spacing .16em–.32em`. Todo lo que parezca telemetría del juego va en mono.

## Logo
Relleno degradado amarillo (`#fff6c4` → `#ffcb05` → `#f7a600`), contorno azul noche de 9px vía `-webkit-text-stroke` con `paint-order: stroke fill`, y tres `drop-shadow` apilados que simulan el relieve impreso. Siempre alineado a la izquierda, con un divisor rojo y un kicker mono debajo.

## Layout
- Rejilla de dos columnas a todo el ancho: marca anclada **arriba a la izquierda** (`align-self:start`), tarjeta de sesión anclada **abajo a la derecha** (`align-self:end`). El centro queda libre para la ilustración.
- Todo alineado a la izquierda dentro de cada bloque.
- El contenedor nunca desborda la ventana: `box-sizing:border-box` y `max-height: calc(100vh - 48px)`.

## Components
- **Botón primario:** degradado rojo, borde amarillo de 2px, radio 4px, sombra sólida inferior de 6px (`#7d0407`) que se hunde al presionar. Brillo diagonal en bucle. Es el único botón lleno de la pantalla.
- **Botón secundario:** contorno azul translúcido, texto mono, hover en amarillo.
- **Tarjeta:** panel casi opaco (`rgba(13,21,54,.93)`), borde azul de 2px, barra tricolor rojo→amarillo→azul de 5px en el borde superior, sombra profunda. Flota con un `pd-bob` de 7s.
- **Input:** fondo casi negro, borde azul 2px, icono a la izquierda, texto Space Mono en mayúsculas. Focus = borde amarillo + halo amarillo al 22%.
- **HUD:** punto verde parpadeante + texto mono para el estado del sistema; fila de metadatos al pie de la tarjeta.

## Motion
Todo es ambiente, nada compite con la lectura: pulsos de 4-6s, rotación de 44s, brillo del botón de 3.4s, flotación de la tarjeta de 7s. Las únicas animaciones rápidas son las de respuesta al usuario (hover 140ms, focus 180ms).

## Rules
- Radios pequeños: 4px en controles, 6px en la tarjeta. Nunca pastilla, nunca cuadrado duro.
- Una sola acción primaria por pantalla.
- El texto siempre sobre un scrim o un panel — nunca directamente sobre el arte.
- El amarillo no se usa para texto de párrafo, solo para etiquetas cortas y bordes.
- Nada de emoji; los iconos vienen de Material Symbols Outlined.

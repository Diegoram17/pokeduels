# ADR 0009: Token OIDC de Vercel — confirmación de exclusión y aceptación de riesgo

## Estado

Aceptado

## Contexto

El diagnóstico de seguridad (obs #281, hallazgo F5) detectó que existe un archivo
`frontend/.env.local` en disco, creado por la CLI de Vercel, que contiene un token
de OIDC (`VERCEL_OIDC_TOKEN`) usado para autenticar comandos de despliegue locales
contra Vercel. Al ser un secreto de un proveedor externo en el árbol del proyecto,
el hallazgo exige verificar que el token no esté expuesto en el control de versiones
ni en los artefactos de build, y documentar la decisión de tratamiento.

La barra de cierre de F5 es documentación: el spec (obs #285) establece que la
confirmación documentada de exclusión es suficiente, salvo que la verificación
encuentre una brecha concreta, en cuyo caso el cierre pasa a ser un fix de código.
La verificación no encontró ninguna brecha.

## Decisión

Mantener el token en `frontend/.env.local` para uso exclusivo de la CLI de Vercel en
la máquina del desarrollador, con la confirmación documentada de los siguientes
hechos verificados el 2026-08-24:

1. **Gitignored**: `frontend/.gitignore` excluye el archivo con el patrón `.env*`
   (línea 27) y también con `*.local`; `git check-ignore -v frontend/.env.local`
   confirma que la regla aplica. El ejemplo `frontend/.env.example` sí está
   versionado (excepción deliberada, sin secretos).
2. **Ausente del historial de git**: `git log --all -- frontend/.env.local` no
   devuelve ningún commit; el token nunca fue commiteado.
3. **No se incluye en el build de Vite**: el nombre de la variable no tiene el
   prefijo `VITE_`, por lo que Vite no la expone en `import.meta.env` ni la inlinea
   en el bundle. Verificación empírica adicional: el valor real del token (1253
   caracteres) no aparece en ningún archivo de `frontend/dist` (JS, HTML, CSS).
4. **Sin referencias en el código**: ninguna búsqueda en `frontend/src` referencia
   `VERCEL_OIDC_TOKEN`.

Sobre esa base se acepta el riesgo residual: el archivo existe solo en la máquina de
desarrollo, fuera del control de versiones, del build y de los logs de CI. Este ADR
es el punto de re-revisión futuro: si aparece un requisito de cumplimiento más
estricto (p. ej., rotación forzada, gestor de secretos, o uso del token en CI), la
decisión debe revisarse.

## Alternativas consideradas

- **Rotar el token y eliminarlo de `frontend/.env.local`** — rechazada: sin un
  requisito de cumplimiento concreto, eliminar el archivo solo traslada el problema
  (el desarrollador lo volvería a generar con la CLI) y la rotación no cambia el
  modelo de exposición (el archivo seguiría existiendo en disco).
- **Mover el token a variables de entorno del CI / secret manager de Vercel** —
  rechazada por ahora: el token se usa solo para comandos locales de la CLI de
  Vercel; no hay ningún job de CI ni paso de build que lo consuma.
- **Endurecer el almacenamiento** (p. ej., cifrado en disco) — rechazada: el
  sistema operativo ya protege la sesión del usuario y el archivo no sale de la
  máquina de desarrollo.

## Consecuencias

- Cierra el hallazgo F5 del diagnóstico como documentación, sin cambios de código.
- El riesgo residual aceptado queda registrado y localizable para una futura
  revisión (este ADR).
- Si alguna vez el token se usara desde CI o el bundle, este ADR deja de aplicar y
  la decisión debe re-evaluarse antes de hacerlo.

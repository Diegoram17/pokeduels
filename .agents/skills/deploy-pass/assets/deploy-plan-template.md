# DEPLOY-PLAN.md — output skeleton

Fill this in during DESIGN, before generating or executing anything. Section order is fixed; omit
a block entirely if it truly doesn't apply to this project — say so in one line instead of leaving
an empty placeholder.

```markdown
# Deploy Plan — {Nombre del proyecto}

Fecha: {fecha}
Estado: {DISEÑADO | GENERADO | EJECUTADO PARCIAL | EJECUTADO | VERIFICADO}

## Resumen del proyecto

{Qué descubrió DISCOVER: stack, framework, servicios externos, infraestructura y CI/CD existentes
(si los hay). 3-6 líneas.}

## Sistema de deployment propuesto

### Build
{Cómo se construye, qué produce, por qué es determinista.}

### Artifact
{Qué es exactamente lo que se deploya, y cómo se versiona/trazabiliza.}

### Config & Secrets
{Qué es config, qué es secret, dónde vive cada uno.}

### Infraestructura
{Dónde va a vivir, y por qué esa elección para ESTE proyecto.}

### Entornos
{Dev/staging/prod y qué cambia entre ellos.}

### Estrategia de release
{Direct / rolling / blue-green / canary / feature flags — y por qué esa, no otra, para este
proyecto.}

### Data & Migrations
{Si aplica: cómo se manejan cambios de esquema y su relación con el rollback de código.}

### Deploy gates
{Qué tiene que pasar antes de que un release proceda.}

### Verify & Observe
{Qué se verifica al terminar, y qué se observa después.}

### Recovery
{Qué pasa si algo falla — rollback, redeploy, restauración de datos, manejo de incidentes.}

## Autorizaciones pendientes

{Lista de acciones EXECUTE que todavía requieren aprobación explícita del usuario antes de
correrse. Vacía solo cuando ya se ejecutaron con permiso — nunca se marca "aprobado" de antemano
para varias acciones a la vez.}

## Registro de ejecución y verificación

{Se completa DESPUÉS de EXECUTE y VERIFY, no antes. Qué se ejecutó, cuándo, con qué resultado; qué
mostró la verificación; qué salió mal (si algo) y cómo se resolvió. Este bloque es lo que convierte
el plan en un registro vivo para el próximo Deploy Pass sobre el mismo proyecto.}
```

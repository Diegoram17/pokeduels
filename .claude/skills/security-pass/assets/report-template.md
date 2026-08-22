# SECURITY-REPORT.md — output skeleton

Fill this in for every Security Pass. Section order is fixed; omit a Finding subsection entirely
if there are truly zero findings in that severity — don't leave empty placeholders.

```markdown
# Security Pass — {Nombre del proyecto}

Fecha: {fecha}
Alcance revisado: {qué capas existían y se revisaron; qué capas se omitieron por falta de material}

## Resumen ejecutivo

{3-6 líneas: los riesgos más importantes encontrados, en lenguaje directo, sin jerga innecesaria.
Si el proyecto está razonablemente sano, decirlo — no inflar riesgo para parecer exhaustivo.}

## Fortalezas de seguridad

{Controles que ya existen y funcionan bien — autenticación bien implementada, validación
consistente, secretos bien manejados, tests de autorización presentes, etc. Sirve para que el
equipo sepa qué NO tocar al remediar.}

## Findings

### CRITICAL

{Uno por finding, con la estructura completa: ID, Title, Severity, Confidence, Category,
Affected artifact, Location, Description, Evidence, Attack scenario, Potential impact,
Existing mitigation, Recommended remediation, Suggested verification, Required change type.}

### HIGH

### MEDIUM

### LOW

### INFO

## Prioridad

{Orden recomendado de atención — no necesariamente el mismo orden que la severidad individual,
porque puede haber dependencias entre findings (ej. arreglar la autenticación antes que la
autorización que depende de ella).}

## Gobernanza / Decisión requerida

{Lista de findings que quedaron marcados como DESIGN / ADR CHANGE, PRODUCT / REQUIREMENT CHANGE,
o ACCEPT RISK — con una frase de por qué no se pueden resolver sin una decisión humana. Si no hay
ninguno, decirlo explícitamente: "Ningún finding de este pase requiere una decisión de producto o
arquitectura — todos son CODE FIX, TEST FIX, SPEC CHANGE o PROCESS / HARNESS CHANGE."}
```

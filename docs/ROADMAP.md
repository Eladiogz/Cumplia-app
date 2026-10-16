# Hoja de ruta

## Fase 1 — Fundación (esta entrega)
Monorepo, CI/CD, datos de ISO 27001:2022, motor de puntaje, SoA, API stateless.

## Fase 2A — Persistencia (hecha)
- Drizzle + PostgreSQL, migraciones, repositorio por organización, auditoría, tests de aislamiento

## Fase 2B — Accesos
- Conectar la API a la base de datos (hecho)
- Autenticación con sesiones (hecho) y MFA TOTP con códigos de recuperación (hecho)
- Roles ADMIN / CONSULTANT / AUDITOR aplicados en cada ruta; MFA obligatorio por organización (hecho)
- Invitaciones para sumar miembros a una organización y elegir organización activa (consultores con varios clientes)
- Detalle en la auditoría (p. ej. rol anterior y nuevo)
- Aislamiento por organización en cada consulta (tests de fuga entre tenants)
- Registro de auditoría de cada cambio

## Fase 3 — Aplicación web
- Next.js: asistente de gap assessment, tablero de madurez, exportación de SoA (PDF/Excel)
- Registro de riesgos

## Fase 4 — Evidencias automáticas
- Integración M365/Entra (MFA, accesos privilegiados, reglas de reenvío)
- Luego Google Workspace, GitHub y AWS

## Fase 5 — Multi-norma
- NIST CSF, CIS Controls, PCI DSS, Ley 25.326 con mapeo cruzado de controles
- Políticas y procedimientos en español con versionado

## Fase 6 — Salida al mercado
- Planes por organización y por consultor, facturación
- Piloto con 1 a 3 clientes reales, verificación de marca y dominio

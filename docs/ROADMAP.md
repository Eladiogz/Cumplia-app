# Hoja de ruta

## Fase 1 — Fundación (esta entrega)
Monorepo, CI/CD, datos de ISO 27001:2022, motor de puntaje, SoA, API stateless.

## Fase 2A — Persistencia (hecha)
- Drizzle + PostgreSQL, migraciones, repositorio por organización, auditoría, tests de aislamiento

## Fase 2B — Accesos (hecha)
- Conectar la API a la base de datos (hecho)
- Autenticación con sesiones (hecho) y MFA TOTP con códigos de recuperación (hecho)
- Roles ADMIN / CONSULTANT / AUDITOR aplicados en cada ruta; MFA obligatorio por organización (hecho)
- Integridad multi-tenant en la base (FK compuestas), auditoría inalterable y test automático de fuga entre organizaciones (hecho)
- Row-Level Security en Postgres con un rol de aplicación sin privilegios (tercera barrera de aislamiento) (hecho)
- Invitaciones para sumar miembros a una organización y elegir organización activa (consultores con varios clientes) (hecho)
- Envío de emails (invitaciones, avisos de seguridad) y recordar la última organización activa al iniciar sesión (hecho)
- Detalle en la auditoría (p. ej. rol anterior y nuevo) (hecho)
- Aislamiento por organización en cada consulta (tests de fuga entre tenants) (hecho)
- Registro de auditoría de cada cambio (hecho)

- Seguridad de cuentas: política de contraseñas robusta (composición + comunes/filtradas + datos personales), recuperación y cambio de contraseña, verificación de email, acciones de ADMIN seguras para multi-tenant (hecho)

## Fase 3 — Aplicación web (hecha)
- Base Next.js (apps/web), proxy /api, acceso completo: ingreso, registro, MFA, invitaciones, organización y seguridad (hecho)
- Asistente de gap assessment (respuestas por control, justificación, evidencia) (hecho)
- Evidencia con archivos (imágenes y PDF en almacenamiento S3, huella SHA-256) y links en las notas (hecho)
- Tablero de madurez (puntaje por dominio, brechas priorizadas) (hecho)
- Exportación de la SoA (PDF/Excel) (hecho)
- Registro de riesgos con matriz 5×5 y mapa de calor (API + web) (hecho)
- Sesiones activas por dispositivo, Content-Security-Policy con nonce, cola de emails con reintentos, tema claro/oscuro (hecho)
- Pruebas de punta a punta en navegador (Playwright) en CI (hecho)

## Antes del piloto
- Revisión de seguridad completa y corrección de hallazgos
- Términos y condiciones, política de privacidad y acuerdo de tratamiento de datos (revisados por un abogado)

## Fase 4 — Evidencias automáticas
- Integración M365/Entra (MFA, accesos privilegiados, reglas de reenvío)
- Luego Google Workspace, GitHub y AWS

## Fase 5 — Multi-norma
- NIST CSF, CIS Controls, PCI DSS, Ley 25.326 con mapeo cruzado de controles
- Políticas y procedimientos en español con versionado

## Fase 6 — Salida al mercado
- Planes por organización y por consultor, facturación
- Piloto con 1 a 3 clientes reales, verificación de marca y dominio

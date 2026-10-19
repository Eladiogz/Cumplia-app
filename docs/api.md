# API

La API responde JSON. Desde el navegador se accede como `/api/*` a través de la web (mismo origen). Errores: `{ "error": "mensaje" }` (a veces con `code`).
- **401**: sin sesión. **403**: sin el permiso necesario (o `MFA_SETUP_REQUIRED` / `EMAIL_NOT_VERIFIED`). **404**: no existe **o es de otra organización** (no se distingue a propósito).

## Públicas (sin estado)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servicio |
| GET | `/frameworks` · `/frameworks/:id` | Marcos disponibles y sus controles |
| POST | `/frameworks/:id/assessment` | Calcula puntaje, brechas y SoA sin guardar nada |

## Autenticación
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/register` | Crea usuario + organización (rol ADMIN) e inicia sesión |
| POST | `/auth/login` | Inicia sesión (con MFA activo responde `{ "mfaRequired": true }`) |
| POST | `/auth/logout` | Cierra y revoca la sesión |
| GET | `/auth/me` | Usuario, organización, rol, `mfaSetupRequired` y `emailVerified` |

## Contraseña y email
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/password/forgot` | `{ email }` → siempre 202 y el mismo mensaje |
| POST | `/auth/password/reset` | `{ token, newPassword }` con el link del email |
| POST | `/auth/password` | Cambiar estando dentro: `{ currentPassword, newPassword }` |
| POST | `/auth/email/verify` | `{ token }` confirma el email |
| POST | `/auth/email/verification` | Reenvía el link de confirmación |

## Doble factor (MFA)
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/mfa/setup` | Genera un secreto pendiente; devuelve `secret` y `otpauthUri` (para el QR) |
| POST | `/auth/mfa/enable` | Confirma con `{ "code" }`; devuelve 10 códigos de recuperación (una sola vez) |
| POST | `/auth/mfa/verify` | Segundo paso del ingreso con `{ "code" }` o `{ "recoveryCode" }` |
| POST | `/auth/mfa/recovery-codes` | 10 códigos nuevos con `{ "code" }` (invalida los anteriores) |
| POST | `/auth/mfa/disable` | Desactiva; exige `password` y un código |

## Cuenta (no dependen de la organización activa)
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/invitations/preview` | `{ token }` → organización, email y rol invitados |
| POST | `/auth/invitations/accept` | Con sesión: la cuenta se une. Sin sesión: `{ token, password, name? }` crea la cuenta |
| GET | `/auth/organizations` | Organizaciones del usuario, con la activa marcada |
| POST | `/auth/switch-organization` | `{ organizationId }` cambia la organización activa (rota la sesión) |
| GET | `/auth/sessions` | Sesiones propias abiertas (todas sus organizaciones), marcando la actual |
| DELETE | `/auth/sessions/:sessionId` | Cierra una sesión propia (la de otra cuenta → 404) |
| POST | `/auth/sessions/revoke-others` | Cierra todas las sesiones menos la actual |

## Por organización (requieren sesión)
| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/assessments` · `/assessments/:id` | Listar (con avance) y ver evaluaciones | todos |
| POST | `/assessments` | Crear evaluación (`name` opcional, `targetMaturity` 1-4) | ADMIN, CONSULTANT |
| PATCH | `/assessments/:id` | Cambiar nombre u objetivo de madurez | ADMIN, CONSULTANT |
| GET · PUT | `/assessments/:id/answers` | Leer (todos) y guardar (ADMIN, CONSULTANT) respuestas | — |
| GET | `/assessments/:id/result` · `/soa` | Puntaje y Declaración de Aplicabilidad | todos |
| GET | `/assessments/:id/soa.pdf` · `/soa.xlsx` | SoA en PDF o Excel | todos, con email verificado |
| GET | `/assessments/:id/evidence` | Evidencia registrada, con su control | todos |
| POST | `/assessments/:id/evidence` | Evidencia de texto | ADMIN, CONSULTANT |
| POST | `/assessments/:id/evidence/files` | Evidencia con archivo (multipart: `controlId`, `description` opcional, `file`) | ADMIN, CONSULTANT |
| GET | `/assessments/:id/evidence/:evidenceId/file` | Ver o descargar el archivo | todos |
| DELETE | `/assessments/:id/evidence/:evidenceId` | Borrar evidencia (queda en la auditoría) | ADMIN, CONSULTANT |
| GET | `/risks` · `/risks/:riskId` | Registro de riesgos | todos |
| POST · PATCH | `/risks` · `/risks/:riskId` | Registrar y editar riesgos | ADMIN, CONSULTANT |
| DELETE | `/risks/:riskId` | Borrar un riesgo (queda en la auditoría) | ADMIN |
| GET | `/risks/owners` | Miembros asignables como responsables | ADMIN, CONSULTANT |
| GET | `/risks.xlsx` | Registro en Excel | todos, con email verificado |
| GET | `/organization` | Datos y políticas de la organización | todos |
| PATCH | `/organization` | Cambiar nombre o exigir MFA (`requireMfa`) | ADMIN |
| GET | `/members` | Miembros, rol y si tienen MFA (revisión de accesos) | ADMIN, AUDITOR |
| PATCH · DELETE | `/members/:userId` | Cambiar rol o quitar de la organización | ADMIN |
| POST | `/members/:userId/password-reset` | Le envía a la persona un link para elegir contraseña | ADMIN |
| POST | `/members/:userId/sessions/revoke` | Cierra sus sesiones en esta organización | ADMIN |
| DELETE | `/members/:userId/mfa` | Restablece su MFA (solo si pertenece únicamente a esta organización) | ADMIN con MFA |
| POST | `/invitations` | Invitar por email con un rol | ADMIN, con email verificado |
| GET | `/invitations` | Invitaciones pendientes | ADMIN, AUDITOR |
| DELETE | `/invitations/:invitationId` | Revocar una invitación | ADMIN |
| GET | `/audit-log` | Registro de auditoría | ADMIN, AUDITOR |

## Probar con curl
Con la API corriendo (`pnpm dev:api`):
```bash
curl -i -c cookies.txt -X POST localhost:3000/auth/register -H "content-type: application/json" \
  -d '{"email":"yo@ejemplo.com","password":"Mate-con-Bizcochos-7","organizationName":"Mi empresa"}'
curl -b cookies.txt -X POST localhost:3000/assessments -H "content-type: application/json" \
  -d '{"frameworkId":"iso27001-2022"}'
curl -b cookies.txt localhost:3000/auth/me
```
`cookies.txt` contiene el token de sesión: está en `.gitignore`, no lo compartas.

Solo en desarrollo, con `ALLOW_DEV_TENANT_HEADER=true`, el header `x-organization-id` elige la organización sin sesión (actúa como ADMIN salvo que `x-role` indique otro). **Nunca** funciona con `NODE_ENV=production`.

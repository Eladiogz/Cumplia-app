# Cumplia

**Cumplimiento sin planillas.** Plataforma GRC para pymes y consultores de LATAM: evaluá tu madurez frente a ISO 27001, generá la Declaración de Aplicabilidad y seguí las brechas, todo en español.

## Estado: Fase 1 completa · Fase 2A (persistencia)
- Monorepo TypeScript (pnpm): `apps/api`, `packages/frameworks`, `packages/core`
- Los 93 controles del Anexo A de ISO/IEC 27001:2022 como datos versionados
- Motor de puntaje de madurez (escala 0-4), brechas priorizadas y Declaración de Aplicabilidad (SoA)
- API Fastify con helmet y rate limit
- CI en GitHub Actions (build, lint, typecheck, tests, auditoría), CodeQL y Dependabot
- `packages/db`: PostgreSQL con Drizzle ORM, migraciones versionadas y acceso a datos **siempre acotado por organización** (`forOrganization`), con registro de auditoría en cada cambio
- Tests de aislamiento entre organizaciones sobre Postgres real en memoria (PGlite), sin Docker

## Empezar
```bash
corepack enable
pnpm install
pnpm build
pnpm test
pnpm dev:api        # http://localhost:3000/health
docker compose up -d db   # PostgreSQL local
cp .env.example .env
export DATABASE_URL=postgresql://cumplia:cumplia@localhost:5432/cumplia
pnpm --filter @cumplia/db db:migrate   # aplica las migraciones
# tras cambiar src/schema.ts: pnpm --filter @cumplia/db db:generate
```

## API
Rutas públicas (sin estado):

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servicio |
| GET | `/frameworks` · `/frameworks/:id` | Marcos disponibles y sus controles |
| POST | `/frameworks/:id/assessment` | Calcula puntaje, brechas y SoA sin guardar nada |

Rutas por organización (requieren sesión; sin ella responden 401, sin el rol necesario 403):

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/assessments` · `/assessments/:id` | Listar y ver evaluaciones | todos |
| POST | `/assessments` | Crear evaluación | ADMIN, CONSULTANT |
| GET · PUT | `/assessments/:id/answers` | Leer (todos) y guardar (ADMIN, CONSULTANT) respuestas | — |
| GET | `/assessments/:id/result` · `/soa` | Puntaje y Declaración de Aplicabilidad | todos |
| POST | `/assessments/:id/evidence` | Registrar evidencia de un control | ADMIN, CONSULTANT |
| GET | `/audit-log` | Registro de auditoría | ADMIN, AUDITOR |
| GET | `/organization` | Datos y políticas de la organización | todos |
| PATCH | `/organization` | Cambiar nombre o exigir MFA (`requireMfa`) | ADMIN |
| GET | `/members` | Miembros, rol y si tienen MFA (revisión de accesos) | ADMIN, AUDITOR |
| PATCH · DELETE | `/members/:userId` | Cambiar rol o quitar de la organización | ADMIN |

### Roles
- **ADMIN**: todo. **CONSULTANT**: trabaja las evaluaciones; no ve auditoría ni administra. **AUDITOR**: solo lectura, incluida auditoría y miembros.
- La matriz vive en `apps/api/src/security/permissions.ts`; lo que no figura se deniega. Cada ruta protegida declara su permiso y, si alguna no lo hace, la API no arranca.
- El rol se lee en cada petición: un cambio o una baja rigen al instante, sin esperar a que venza la sesión.
- Una organización nunca puede quedar sin ADMIN.
- Con `requireMfa` activo, quien no tenga MFA solo puede iniciar sesión y configurarlo (el resto responde 403 `MFA_SETUP_REQUIRED`; `/auth/me` devuelve `mfaSetupRequired`). Para activarlo, el ADMIN tiene que tener MFA.

### Autenticación
Sesiones en el servidor con cookie `httpOnly` + `SameSite=Lax` (y `Secure` en producción). En la base solo se guarda el hash del token, así que se pueden revocar al instante.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/register` | Crea usuario + organización (rol ADMIN) e inicia sesión |
| POST | `/auth/login` | Inicia sesión |
| POST | `/auth/logout` | Cierra y revoca la sesión |
| GET | `/auth/me` | Usuario, organización y rol actuales |

- Contraseñas con scrypt (N=2^16), mínimo 12 caracteres.
- Bloqueo de cuenta tras 5 intentos fallidos (15 min); error idéntico para usuario inexistente y clave incorrecta.
- Límite de 10 peticiones/minuto por IP en registro e inicio de sesión.
- Peticiones que modifican datos desde un `Origin` no incluido en `APP_ORIGIN` se rechazan (403).
- Registro de auditoría de altas, accesos correctos, fallidos y cierres de sesión.

### Doble factor (MFA)
TOTP compatible con Google Authenticator, Microsoft Authenticator, 1Password, etc.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/mfa/setup` | Genera un secreto pendiente; devuelve `secret` y `otpauthUri` (para el QR) |
| POST | `/auth/mfa/enable` | Confirma con `{ "code" }`; devuelve 10 códigos de recuperación (se muestran **una sola vez**) |
| POST | `/auth/mfa/verify` | Segundo paso del login con `{ "code" }` o `{ "recoveryCode" }` |
| POST | `/auth/mfa/disable` | Desactiva; exige `password` y un código |

- Con MFA activo, `/auth/login` responde `{ "mfaRequired": true }` y una cookie de desafío (5 min, solo para `/auth/mfa`) que **no** sirve como sesión; la sesión se crea en `/auth/mfa/verify`.
- El secreto se guarda cifrado con AES-256-GCM usando `MFA_ENCRYPTION_KEY` (fuera de la base); los códigos de recuperación, solo como hash.
- Un código TOTP no se acepta dos veces; los fallos cuentan para el mismo bloqueo de cuenta que la contraseña.
- Al activar MFA se cierran las demás sesiones abiertas del usuario.
- Auditoría: `mfa.enabled`, `mfa.disabled`, `mfa.disable_failed`, `auth.mfa_failed`, `mfa.recovery_code_used`.

### Probar en local
```bash
docker compose up -d db
cp .env.example .env
echo "MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env   # solo la primera vez
set -a && . ./.env && set +a
pnpm --filter @cumplia/db db:migrate
pnpm dev:api          # en una terminal; dejala abierta
```
En **otra** terminal:
```bash
curl -i -c cookies.txt -X POST localhost:3000/auth/register -H "content-type: application/json" \
  -d '{"email":"yo@ejemplo.com","password":"una-clave-larga-123","organizationName":"Mi empresa"}'
curl -b cookies.txt -X POST localhost:3000/assessments -H "content-type: application/json" \
  -d '{"frameworkId":"iso27001-2022"}'
curl -b cookies.txt localhost:3000/auth/me
```
El header `x-organization-id` (solo desarrollo) sigue disponible con `ALLOW_DEV_TENANT_HEADER=true`; actúa como ADMIN salvo que se indique otro rol con `x-role`. Nunca funciona con `NODE_ENV=production`.

## Flujo de trabajo Git
- `main` protegida: solo entra por Pull Request con CI en verde.
- Ramas `feat/…`, `fix/…`, `docs/…`, `chore/…`.
- [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/): `feat(core): agrega ...`.
- Versionado semántico con tags `vX.Y.Z`.

## Nota sobre ISO
El repositorio incluye solo los **títulos** de los controles (traducidos). El texto de la norma está protegido por ISO: para mostrar guías o requisitos completos hay que adquirir la licencia correspondiente o redactar contenido propio.

Hoja de ruta en [`docs/ROADMAP.md`](docs/ROADMAP.md).

Licencia
Este proyecto es propietario.

Todos los derechos reservados.

No se permite el uso, copia, modificación, distribución o explotación comercial sin autorización expresa y por escrito del titular.



# Cumplia

**Cumplimiento sin planillas.** Plataforma GRC para pymes y consultores de LATAM: evaluá tu madurez frente a ISO 27001, generá la Declaración de Aplicabilidad y seguí las brechas, todo en español.

## Estado: Fases 1, 2A y 2B completas · Fase 3 (aplicación web) en curso
- Monorepo TypeScript (pnpm): `apps/api`, `apps/web`, `packages/frameworks`, `packages/core`, `packages/db`
- `apps/web`: Next.js + Tailwind + componentes estilo shadcn/ui. Ingreso, registro, verificación en dos pasos, recuperación de contraseña, invitaciones, selector de organización, seguridad, organización y el **asistente de evaluación**: los 93 controles por dominio, aplica/no aplica (con justificación obligatoria), madurez 0-4 con descripción de cada nivel, notas, evidencia, avance por dominio y guardado automático (ADMIN y CONSULTANT editan; AUDITOR ve en modo lectura), tablero de resultados, exportación de la SoA y el **registro de riesgos** con mapa de calor
- Los 93 controles del Anexo A de ISO/IEC 27001:2022 como datos versionados
- Motor de puntaje de madurez (escala 0-4), brechas priorizadas y Declaración de Aplicabilidad (SoA)
- API Fastify con helmet y rate limit
- CI en GitHub Actions (build, lint, typecheck, tests, auditoría), CodeQL y Dependabot
- `packages/db`: PostgreSQL con Drizzle ORM, migraciones versionadas y acceso a datos **siempre acotado por organización** (`forOrganization`), con registro de auditoría en cada cambio
- Tests de aislamiento entre organizaciones sobre Postgres real en memoria (PGlite), sin Docker

### Multi-tenant: cómo se aíslan las organizaciones
1. **Código**: todo acceso a datos de negocio pasa por `forOrganization(db, orgId)`; un recurso ajeno responde 404 (no revela que existe).
2. **Base de datos**: FK compuestas `(id, organization_id)` entre evaluaciones, respuestas y evidencia; sesiones y desafíos MFA atados a la membresía `(user_id, organization_id)`. La base rechaza cualquier fila que mezcle organizaciones.
3. **Row-Level Security**: en `assessments`, `control_answers`, `evidence`, `invitations`, `risks` y `audit_logs`, Postgres solo devuelve y deja escribir filas de la organización fijada en la transacción (`forOrganization` lo hace siempre). Sin organización activa: ninguna fila. La API se conecta con un usuario del rol `cumplia_app`, sin privilegios de dueño; **en producción se niega a arrancar** si la conexión se saltearía RLS (superusuario, `BYPASSRLS` o dueño).
4. **Auditoría inalterable**: un trigger impide `UPDATE`, `DELETE` y `TRUNCATE` sobre `audit_logs`, y el rol de la API ni siquiera tiene esos permisos.
5. **Tests que se mantienen solos**: `tenant-isolation.test.ts` descubre todas las rutas protegidas y verifica que una organización no pueda leer ni modificar datos de otra; otro test exige RLS en toda tabla nueva con `organization_id`. Todos los tests corren con el mismo rol que la API.

Las tablas de identidad (`users`, `sessions`, `mfa_challenges`, `memberships`) no tienen RLS: se consultan antes de saber la organización (login, cookie). Su aislamiento lo dan las FK a la membresía y el código.

## Empezar
```bash
corepack enable
pnpm install
pnpm build
pnpm test
docker compose up -d db mail files   # PostgreSQL (crea cumplia_api), Mailpit (http://localhost:8025) y SeaweedFS (S3, archivos)
cp .env.example .env
sed -i "s|^MFA_ENCRYPTION_KEY=.*|MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
set -a && . ./.env && set +a
pnpm --filter @cumplia/db db:migrate   # con MIGRATION_DATABASE_URL (dueño)
pnpm dev:api        # terminal 1: API en http://localhost:3000 (con DATABASE_URL = cumplia_api)
pnpm dev:web        # terminal 2 (con el .env cargado): web en http://localhost:3001
# tras cambiar src/schema.ts: pnpm --filter @cumplia/db db:generate
```
Abrí **http://localhost:3001**: la web reenvía `/api/*` a la API (mismo origen, sin CORS; la cookie de sesión funciona sola). Los emails (invitaciones, avisos) se ven en Mailpit: http://localhost:8025.

### Web y API detrás del proxy
- `API_URL`: a dónde reenvía la web `/api/*`. Se lee **al compilar** la web (`next build`) y al arrancarla.
- `API_PUBLIC_PREFIX=/api`: la API sabe que el navegador la ve bajo `/api` (p. ej. para la ruta de la cookie del segundo paso del login).
- `TRUST_PROXY`: IPs del proxy (la web). Solo de ellas la API acepta `X-Forwarded-For`; así el límite de intentos es por usuario real y nadie más puede falsificar su IP.
- `APP_ORIGIN` debe ser el origen de la web (protección CSRF) y es la base de los links de los emails.
- La web solo muestra u oculta controles según el rol; **quien decide es siempre la API**.

**Si ya tenías el volumen de Postgres creado** (el script de inicio solo corre con un volumen nuevo), creá el usuario de la API una vez:
```bash
docker compose exec db psql -U cumplia -d cumplia -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cumplia_app') THEN CREATE ROLE cumplia_app NOLOGIN; END IF; END \$\$;" -c "CREATE ROLE cumplia_api LOGIN PASSWORD 'cumplia_api' IN ROLE cumplia_app;"
```

**En producción**: creá el rol `cumplia_app` antes de migrar si el usuario de migraciones no tiene `CREATEROLE`, y un usuario de login para la API con `GRANT cumplia_app TO <usuario>`. Las migraciones que modifiquen datos de tablas con RLS deben fijar `app.organization_id` o correr como superusuario.

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
| GET | `/assessments` · `/assessments/:id` | Listar (con avance `answered`/`total`) y ver evaluaciones | todos |
| POST | `/assessments` | Crear evaluación (`name` opcional, `targetMaturity` 1-4) | ADMIN, CONSULTANT |
| PATCH | `/assessments/:id` | Cambiar nombre u objetivo de madurez | ADMIN, CONSULTANT |
| GET | `/assessments/:id/evidence` | Evidencia registrada, con su control | todos |
| POST | `/assessments/:id/evidence/files` | Evidencia con archivo (multipart: `controlId`, `description` opcional, `file`) | ADMIN, CONSULTANT |
| GET | `/assessments/:id/evidence/:evidenceId/file` | Ver o descargar el archivo | todos |
| DELETE | `/assessments/:id/evidence/:evidenceId` | Borrar evidencia (queda en la auditoría) | ADMIN, CONSULTANT |
| GET · PUT | `/assessments/:id/answers` | Leer (todos) y guardar (ADMIN, CONSULTANT) respuestas | — |
| GET | `/assessments/:id/result` · `/soa` | Puntaje y Declaración de Aplicabilidad | todos |
| POST | `/assessments/:id/evidence` | Registrar evidencia de un control | ADMIN, CONSULTANT |
| GET | `/audit-log` | Registro de auditoría | ADMIN, AUDITOR |
| GET | `/organization` | Datos y políticas de la organización | todos |
| PATCH | `/organization` | Cambiar nombre o exigir MFA (`requireMfa`) | ADMIN |
| GET | `/members` | Miembros, rol y si tienen MFA (revisión de accesos) | ADMIN, AUDITOR |
| PATCH · DELETE | `/members/:userId` | Cambiar rol o quitar de la organización | ADMIN |
| POST | `/invitations` | Invitar por email con un rol (el link viaja **solo** por email) | ADMIN |
| GET | `/invitations` | Invitaciones pendientes | ADMIN, AUDITOR |
| DELETE | `/invitations/:invitationId` | Revocar una invitación | ADMIN |
| GET | `/risks` · `/risks/:riskId` | Registro de riesgos | todos |
| POST · PATCH | `/risks` · `/risks/:riskId` | Registrar y editar riesgos | ADMIN, CONSULTANT |
| DELETE | `/risks/:riskId` | Borrar un riesgo (queda en la auditoría) | ADMIN |
| GET | `/risks/owners` | Miembros asignables como responsables | ADMIN, CONSULTANT |
| GET | `/risks.xlsx` | Registro en Excel: Resumen (con la matriz) y Riesgos (filtrable) | todos, con email verificado |

### Registro de riesgos (`/riesgos`)
Evaluación y tratamiento de riesgos (ISO/IEC 27001 cláusulas 6.1.2 y 6.1.3):
- **Matriz 5×5**: probabilidad (Rara → Casi segura) × impacto (Insignificante → Catastrófico). Puntaje 1-25 → **Bajo** ≤ 4 · **Medio** ≤ 9 · **Alto** ≤ 16 · **Crítico** > 16. Las reglas viven en `@cumplia/core/risk` y las comparten la API y la web.
- Cada riesgo: código correlativo por organización (R-001…), activo, amenaza, tratamiento (mitigar, aceptar, transferir, evitar) con su plan, controles del Anexo A, **riesgo residual**, estado, responsable y fecha límite.
- **Aceptar exige justificación**, y el estado *Aceptado* solo vale con tratamiento *Aceptar*. Se valida sobre el resultado de cada cambio (también en un PATCH parcial).
- El responsable tiene FK compuesta a la **membresía** de la misma organización: no se puede asignar a alguien de otra, y si deja la organización el riesgo queda sin responsable (`ON DELETE SET NULL (owner_id)`, PostgreSQL 15+).
- La web muestra un **mapa de calor** (inherente/residual; tooltip con mouse y teclado; clic en una celda para filtrar; vista de tabla), los niveles con ícono + etiqueta, y marca los riesgos abiertos con la fecha límite vencida.

### Resultado y tablero (`/evaluaciones/:id/resultado`)
`GET /assessments/:id/result` devuelve: puntaje general y madurez promedio **sobre lo ya evaluado** (los pendientes no cuentan como 0; `coverage` dice cuánto se evaluó), controles que alcanzan el objetivo, distribución por nivel 0-4, puntaje/promedio por dominio y brechas con su dominio y tamaño, **ordenadas de la más grande a la más chica**.

La web lo muestra como cifra principal + indicadores, madurez por dominio (barras con la línea del objetivo), controles por nivel (escala ordinal de un solo tono) y la tabla de brechas, con link a cada control en el asistente. Colores validados con el validador de paleta (contraste y separación); cada gráfico tiene tooltip (mouse y teclado) y **vista de tabla** equivalente; las severidades llevan ícono + etiqueta, nunca solo color.

### Exportar la Declaración de Aplicabilidad (SoA)
| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/assessments/:id/soa.pdf` | SoA en PDF (A4 apaisado, para firmar y presentar) | todos, con email verificado |
| GET | `/assessments/:id/soa.xlsx` | SoA en Excel: hojas Resumen, Declaración de Aplicabilidad (filtrable) y Brechas | todos, con email verificado |

- Por cada control del Anexo A: título, si aplica, **justificación de inclusión o exclusión**, estado de implementación (madurez) y cantidad de evidencias (ISO/IEC 27001 cláusula 6.1.3 d).
- Se generan en el servidor desde los mismos datos que valida la API (acotados a la organización con RLS) y cada exportación queda en la auditoría (`soa.export`).
- Los textos de los usuarios se escriben en el Excel como **texto**: nunca se interpretan como fórmulas.

### Archivos de evidencia
- Imágenes **PNG, JPG, WebP** y **PDF**, hasta **10 MB**. El tipo se verifica por el **contenido** del archivo (no por la extensión): un SVG o HTML disfrazado de imagen se rechaza.
- Se guardan en un almacenamiento **compatible con S3** (AWS S3, Cloudflare R2, Backblaze…; en desarrollo, SeaweedFS con `docker compose up -d files`). En producción `S3_BUCKET` es obligatorio y el bucket debe existir (con AWS, usá `S3_SSE=AES256`).
- La clave de cada archivo la arma la API bajo `org/<organización>/…`; el nombre del usuario solo se muestra (saneado).
- Cada archivo guarda su **huella SHA-256**: permite demostrar ante un auditor que no cambió desde que se cargó.
- Solo se descargan **a través de la API** (que verifica organización y rol), con `nosniff`, CSP `sandbox` y sin caché compartida.

### Invitaciones y organización activa
Rutas de la cuenta (no dependen de la organización activa):

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/invitations/preview` | `{ token }` → organización, email y rol invitados |
| POST | `/auth/invitations/accept` | Con sesión: la cuenta se une y pasa a esa organización. Sin sesión: `{ token, password, name? }` crea la cuenta |
| GET | `/auth/organizations` | Organizaciones del usuario, con la activa marcada |
| POST | `/auth/switch-organization` | `{ organizationId }` cambia la organización activa |

- La invitación vence a los 7 días, sirve una vez y en la base solo queda el hash del token. Reinvitar al mismo email invalida el link anterior.
- El email lo fija la invitación: un link reenviado no sirve para otra cuenta. Si el email ya tiene cuenta, hay que iniciar sesión para aceptar (se respetan su contraseña y su MFA).
- Cambiar de organización (o aceptar con sesión) rota la sesión: la anterior se cierra y la nueva queda atada a la membresía elegida.
- El token viaja **solo** en el email (`APP_URL/invitaciones/aceptar#token=…`, en el fragmento para que no llegue a ningún servidor ni al `Referer`): aceptar demuestra que la persona controla esa casilla; ni el ADMIN que invita lo ve. Si el email no sale, la invitación se revoca y la API responde 502.
- Al iniciar sesión se entra a la última organización usada (si sigue siendo miembro; si no, a la primera).

### Emails
- Producción: `SMTP_URL` obligatorio (cualquier proveedor SMTP) y `MAIL_FROM`. Desarrollo: Mailpit (`docker compose up -d mail`, bandeja en http://localhost:8025); sin `SMTP_URL`, los emails se escriben en el log de la API.
- Avisos de seguridad (en segundo plano, no demoran ni hacen fallar la respuesta): MFA activado, MFA desactivado, ingreso con código de recuperación (con cuántos quedan) y cuenta bloqueada por intentos fallidos (una vez por bloqueo).
- Los datos que cargan los usuarios (p. ej. nombre de la organización) se escapan en el HTML.
- La tabla `invitations` tiene RLS: la organización ve las suyas y quien acepta solo puede **leer** la invitación cuyo token presenta.

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

- Contraseñas con scrypt (N=2^16). Bloqueo de cuenta tras 5 intentos fallidos (15 min, con aviso por email); error idéntico para usuario inexistente y clave incorrecta.

### Política de contraseñas
Definida una sola vez en `@cumplia/core/password` (la web la usa para guiar con medidor y lista de requisitos; la API la aplica):
- Entre 12 y 128 caracteres, con **mayúscula, minúscula, número y carácter especial**.
- Sin el mismo carácter 4 veces seguidas.
- Sin datos de la persona: email, nombre, organización ni «Cumplia».
- **No puede ser común ni filtrada**: lista local con las 10.000 más usadas en filtraciones (SecLists) + términos frecuentes en español, detectadas aunque tengan números/símbolos de relleno o leetspeak (`P@ssw0rd2024!` → `password`). Sin servicios externos.
- La API responde 400 `WEAK_PASSWORD` con las reglas que fallaron.

### Recuperación y verificación
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/password/forgot` | `{ email }` → siempre 202 y el mismo mensaje (no revela si la cuenta existe) |
| POST | `/auth/password/reset` | `{ token, newPassword }` con el link del email |
| POST | `/auth/password` | Cambiar estando dentro: `{ currentPassword, newPassword }` |
| POST | `/auth/email/verify` | `{ token }` confirma el email |
| POST | `/auth/email/verification` | Reenvía el link de confirmación |

- El link de restablecimiento vence a los **30 minutos**, sirve una vez y solo vale el último enviado. La contraseña nueva se valida antes de gastar el link. Al restablecer se cierran **todas** las sesiones, se desbloquea la cuenta y **se sigue pidiendo MFA** al ingresar.
- Cambiar la contraseña exige la actual y cierra las otras sesiones. Ambos casos avisan por email y quedan en la auditoría de cada organización de la persona.
- El registro directo envía un link de confirmación (24 h). Sin confirmar se puede usar Cumplia, pero **no invitar** (403 `EMAIL_NOT_VERIFIED`). Las cuentas creadas por invitación ya vienen verificadas.

### Acciones del ADMIN sobre un miembro (seguras para multi-tenant)
Una cuenta puede pertenecer a varias organizaciones (p. ej. un consultor con varios clientes), así que el ADMIN de una **nunca** toca la contraseña ni debilita el acceso de las demás:

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/members/:userId/password-reset` | Le envía un link para que **la persona** elija una contraseña nueva (el ADMIN no la ve ni la fija) |
| POST | `/members/:userId/sessions/revoke` | Cierra sus sesiones **en esta organización** |
| DELETE | `/members/:userId/mfa` | Restablece su MFA **solo si la cuenta pertenece únicamente a esta organización**, y solo si el ADMIN tiene MFA activo |
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
| POST | `/auth/mfa/recovery-codes` | Genera 10 códigos de recuperación nuevos con `{ "code" }` (invalida los anteriores) |
| POST | `/auth/mfa/disable` | Desactiva; exige `password` y un código. No se puede si **alguna** de sus organizaciones exige MFA |

- Con MFA activo, `/auth/login` responde `{ "mfaRequired": true }` y una cookie de desafío (5 min, solo para `/auth/mfa`) que **no** sirve como sesión; la sesión se crea en `/auth/mfa/verify`.
- El secreto se guarda cifrado con AES-256-GCM usando `MFA_ENCRYPTION_KEY` (fuera de la base); los códigos de recuperación, solo como hash.
- Un código TOTP no se acepta dos veces; los fallos cuentan para el mismo bloqueo de cuenta que la contraseña.
- Al activar MFA se cierran las demás sesiones abiertas del usuario.
- Auditoría: `mfa.enabled`, `mfa.disabled`, `mfa.disable_failed`, `auth.mfa_failed`, `mfa.recovery_code_used`, `mfa.recovery_codes_regenerated`. Cada evento puede llevar `details` (p. ej. rol anterior y nuevo, motivo de un fallo); nunca secretos.

### Probar en local
Con la base y el `.env` preparados como en [Empezar](#empezar), dejá `pnpm dev:api` corriendo en una terminal. En **otra** terminal:
```bash
curl -i -c cookies.txt -X POST localhost:3000/auth/register -H "content-type: application/json" \
  -d '{"email":"yo@ejemplo.com","password":"Mate-con-Bizcochos-7","organizationName":"Mi empresa"}'
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



# Operación

## Desarrollo local
```bash
corepack enable
pnpm install
pnpm build
docker compose up -d db mail files   # PostgreSQL (crea cumplia_api), Mailpit y SeaweedFS (S3)
cp .env.example .env
sed -i "s|^MFA_ENCRYPTION_KEY=.*|MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
set -a && . ./.env && set +a
pnpm --filter @cumplia/db db:migrate   # con MIGRATION_DATABASE_URL (dueño)
pnpm dev:api        # terminal 1: API en http://localhost:3000
pnpm dev:web        # terminal 2 (con el .env cargado): web en http://localhost:3001
```
- Tras cambiar `packages/db/src/schema.ts`: `pnpm --filter @cumplia/db db:generate` y revisar la migración generada (RLS, permisos).
- Bandeja de emails (Mailpit): http://localhost:8025.

**Si ya tenías el volumen de Postgres creado** (el script de inicio solo corre con un volumen nuevo), creá el usuario de la API una vez:
```bash
docker compose exec db psql -U cumplia -d cumplia -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cumplia_app') THEN CREATE ROLE cumplia_app NOLOGIN; END IF; END \$\$;" -c "CREATE ROLE cumplia_api LOGIN PASSWORD 'cumplia_api' IN ROLE cumplia_app;"
```

## Variables de entorno
### API
| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | sí | Conexión con el usuario **sin privilegios** (rol `cumplia_app`). En producción la API no arranca si se saltearía RLS |
| `MIGRATION_DATABASE_URL` | para migrar | Conexión del **dueño** de las tablas |
| `MFA_ENCRYPTION_KEY` | sí | 32 bytes en base64 (`openssl rand -base64 32`). Cifra los secretos MFA y la cola de emails. Una por entorno, guardada fuera del servidor: sin ella, nadie con MFA puede ingresar |
| `APP_ORIGIN` | sí | Origen(es) de la web, separados por coma (protección CSRF) |
| `APP_URL` | no | Base de los links de los emails (por defecto, el primer `APP_ORIGIN`) |
| `PORT` | no | Por defecto 3000 |
| `TRUST_PROXY` | detrás de proxy | IPs/CIDR del proxy (la web). Solo de ellas se acepta `X-Forwarded-For` |
| `API_PUBLIC_PREFIX` | detrás de la web | `/api`: cómo ve el navegador la API (ruta de la cookie del segundo paso del login) |
| `SMTP_URL` · `MAIL_FROM` | en producción | Cualquier proveedor SMTP (`smtps://usuario:clave@host:465`) |
| `S3_BUCKET` · `S3_REGION` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` | en producción | Almacenamiento de evidencia |
| `S3_ENDPOINT` · `S3_FORCE_PATH_STYLE` | no S3 de AWS | Para R2, Backblaze, SeaweedFS… |
| `S3_SSE` | recomendada en AWS | `AES256`: cifrado del lado del servidor |
| `AUTH_RATE_LIMIT` · `API_RATE_LIMIT` | no | Peticiones por minuto y por IP (por defecto 10 en ingreso/registro/MFA y 100 en el resto) |
| `ALLOW_DEV_TENANT_HEADER` | no | Solo desarrollo; ignorado en producción |
| `NODE_ENV` | en producción | `production`: cookies `Secure`, controles de arranque estrictos |

### Web
| Variable | Descripción |
|---|---|
| `API_URL` | A dónde reenvía la web `/api/*`. Se lee **al compilar** (`next build`) y al arrancar |

## Producción
- **HTTPS obligatorio** delante de la web (las cookies son `Secure`), con HSTS en el balanceador o proxy.
- **Base de datos**: creá el rol `cumplia_app` antes de migrar si el usuario de migraciones no tiene `CREATEROLE`, y un usuario de login para la API con `GRANT cumplia_app TO <usuario>`. La API **no arranca** si su conexión se saltearía RLS. Las migraciones que modifiquen datos de tablas con RLS deben fijar `app.organization_id` o correr como superusuario.
- **Obligatorios al arrancar con `NODE_ENV=production`**: `SMTP_URL`, `S3_BUCKET` (el bucket debe existir), `MFA_ENCRYPTION_KEY`, y una conexión que respete RLS.
- **Secretos** (`MFA_ENCRYPTION_KEY`, credenciales de base, SMTP y S3) en un gestor de secretos, nunca en el repositorio ni en la imagen.
- **Respaldos** de PostgreSQL y del bucket de evidencia, cifrados y probados (restaurar periódicamente). La clave `MFA_ENCRYPTION_KEY` se respalda aparte.

## Emails
- Todo email (invitaciones, recuperación de contraseña, avisos de seguridad) se guarda primero en la tabla `email_outbox` y un proceso de la API lo envía. Si el SMTP falla, **no se pierde**: se reintenta con espera creciente (1, 2, 4… hasta 60 minutos; 8 intentos, unas 2 horas). La petición responde sin esperar al servidor de correo.
- El contenido va **cifrado** (clave derivada de `MFA_ENCRYPTION_KEY`, atada a cada fila). Al enviarse, la fila se borra; si se agotan los intentos, queda solo el error, sin contenido (se purga a los 30 días).
- Con varias instancias de la API cada email se envía **una sola vez** (`FOR UPDATE SKIP LOCKED`).
- Cambiar `MFA_ENCRYPTION_KEY` deja ilegibles los emails pendientes en ese momento (se descartan con error en el log).
- En desarrollo sin `SMTP_URL`, los emails (con sus links) se escriben en el log de la API.

## Almacenamiento de evidencia
- Compatible con S3: AWS S3, Cloudflare R2, Backblaze…; en desarrollo, SeaweedFS (`docker compose up -d files`, credenciales en `docker/seaweedfs/s3.json`).
- En desarrollo el bucket se crea solo; en producción tiene que existir.
- Sin `S3_BUCKET` (solo desarrollo), la carga de archivos responde 503 y el resto funciona.

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

Rutas por organización (requieren tenant; sin él responden 401):

| Método | Ruta | Descripción |
|---|---|---|
| POST · GET | `/assessments` | Crear y listar evaluaciones |
| GET | `/assessments/:id` | Detalle |
| GET · PUT | `/assessments/:id/answers` | Leer y guardar respuestas |
| GET | `/assessments/:id/result` · `/soa` | Puntaje y Declaración de Aplicabilidad |
| POST | `/assessments/:id/evidence` | Registrar evidencia de un control |
| GET | `/audit-log` | Registro de auditoría |

### Probar en local (solo desarrollo)
Mientras no exista el login (`feat/auth-core`), la organización se indica con un header. Está desactivado salvo que `ALLOW_DEV_TENANT_HEADER=true` y nunca funciona con `NODE_ENV=production`.
```bash
docker compose up -d db
export DATABASE_URL=postgresql://cumplia:cumplia@localhost:5432/cumplia
export ALLOW_DEV_TENANT_HEADER=true
pnpm --filter @cumplia/db db:migrate
pnpm --filter @cumplia/db db:seed "Mi empresa"     # imprime el ID de la organización
pnpm dev:api
curl -X POST localhost:3000/assessments -H "x-organization-id: <ID>" \
  -H "content-type: application/json" -d '{"frameworkId":"iso27001-2022"}'
```

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



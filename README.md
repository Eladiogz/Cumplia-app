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

## API (Fase 1, sin estado)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servicio |
| GET | `/frameworks` | Marcos disponibles |
| GET | `/frameworks/:id` | Controles de un marco |
| POST | `/frameworks/:id/assessment` | Puntaje, brechas y SoA a partir de las respuestas |

## Flujo de trabajo Git
- `main` protegida: solo entra por Pull Request con CI en verde.
- Ramas `feat/…`, `fix/…`, `docs/…`, `chore/…`.
- [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/): `feat(core): agrega ...`.
- Versionado semántico con tags `vX.Y.Z`.

## Nota sobre ISO
El repositorio incluye solo los **títulos** de los controles (traducidos). El texto de la norma está protegido por ISO: para mostrar guías o requisitos completos hay que adquirir la licencia correspondiente o redactar contenido propio.

Hoja de ruta en [`docs/ROADMAP.md`](docs/ROADMAP.md).

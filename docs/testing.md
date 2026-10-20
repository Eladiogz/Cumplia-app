# Pruebas

## Unitarias y de integración
```bash
pnpm test
```
- **Vitest** en cada paquete. Los tests de la API y de la base corren sobre **Postgres real en memoria (PGlite)**, sin Docker, con el **mismo rol sin privilegios** que la API (RLS se aplica).
- `apps/api/src/tenant-isolation.test.ts` descubre **todas** las rutas protegidas y verifica, con una sesión de otra organización, que ninguna deje leer ni modificar datos ajenos. Una ruta nueva queda cubierta sola (si usa un parámetro o un cuerpo nuevo, el test pide agregarlo).
- Otro test exige Row-Level Security en toda tabla con `organization_id`.

## De punta a punta (Playwright)
`apps/e2e` recorre la aplicación como una persona: la web y la API compiladas, Postgres real y Mailpit para leer los emails de verdad.
```bash
docker compose up -d db mail
pnpm build
pnpm --filter @cumplia/e2e exec playwright install chromium   # una vez
pnpm test:e2e
```
- Cubre: registro y confirmación por email, ingreso, recuperación de contraseña, MFA con código TOTP, evaluación y exportación de la SoA, registro de riesgos y mapa de calor, corregir el nombre, exportar y eliminar la organización, tema, celular, y **multi-tenant** (otra organización no ve ni abre datos ajenos; una invitación da acceso solo a la organización que invita, con su rol).
- Cada prueba **falla si aparece una violación de la CSP o un error de JavaScript** en el navegador; una prueba confirma que un script inyectado queda bloqueado.
- Usa una base **temporal** (`cumplia_e2e_pw`, se recrea en cada corrida) y los puertos 3200 (API) y 3201 (web): no toca la base de desarrollo.
- En Linux/WSL, Chromium necesita librerías del sistema: `sudo pnpm --filter @cumplia/e2e exec playwright install-deps chromium`.
- Para los avisos de la app usá el helper `appAlert()`, **no** `getByRole("alert")`: Next.js agrega su propio `role="alert"` (anunciador de rutas) y la prueba pasaría o fallaría por casualidad.

## Capturas del manual de usuario
```bash
docker compose up -d db mail files
pnpm build
pnpm manual:capturas
```
`apps/e2e/manual/capturas.spec.ts` recorre la aplicación como un cliente nuevo y regenera las imágenes de [`docs/manual/img`](manual/img). Usa su propio entorno (puertos 3300/3301, base `cumplia_e2e_manual` y el almacenamiento de archivos de desarrollo). Correlo cuando cambie la interfaz y revisá las imágenes antes de hacer el commit.

Las compilaciones de la web para las pruebas y el manual van a `apps/web/.next-e2e` y `.next-manual` (variable `NEXT_DIST_DIR`): no pisan la de quien usa la app en su máquina.

## CI (GitHub Actions)
- **verify**: instalación con lockfile congelado, build, lint, typecheck, tests y `pnpm audit`.
- **e2e**: Postgres y Mailpit como servicios, Chromium con sus dependencias y la suite de Playwright. Si algo falla, sube el reporte con capturas y trazas (7 días).
- CodeQL y Dependabot.

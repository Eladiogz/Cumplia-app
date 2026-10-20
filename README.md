# Cumplia

**Cumplimiento sin planillas.** Plataforma GRC para pymes y consultores de LATAM: evaluá tu madurez frente a ISO 27001, generá la Declaración de Aplicabilidad, gestioná los riesgos y seguí las brechas, todo en español.

## Qué hace
- **Evaluación ISO/IEC 27001:2022**: los 93 controles del Anexo A, aplica/no aplica con justificación, madurez 0-4, notas y evidencia (archivos con huella SHA-256).
- **Tablero de resultados**: puntaje por dominio, distribución de madurez y brechas priorizadas.
- **Declaración de Aplicabilidad (SoA)** en PDF y Excel.
- **Registro de riesgos** con matriz 5×5, mapa de calor, tratamiento, riesgo residual y responsables.
- **Multi-organización**: un consultor trabaja con varios clientes, cada uno aislado en tres capas (código, base de datos y Row-Level Security).
- **Seguridad de cuentas**: MFA (TOTP), política de contraseñas, sesiones activas, roles y auditoría inalterable.

## Empezar
```bash
corepack enable
pnpm install && pnpm build && pnpm test
docker compose up -d db mail files
cp .env.example .env
sed -i "s|^MFA_ENCRYPTION_KEY=.*|MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
set -a && . ./.env && set +a
pnpm --filter @cumplia/db db:migrate
pnpm dev:api        # terminal 1: API en http://localhost:3000
pnpm dev:web        # terminal 2: web en http://localhost:3001
```
Abrí **http://localhost:3001**. Los emails se ven en Mailpit: http://localhost:8025. Detalle (variables, producción, problemas comunes) en [Operación](docs/operations.md).

## Documentación
| Documento | Contenido |
|---|---|
| [Arquitectura](docs/architecture.md) | Monorepo, componentes, flujo de una petición, datos y decisiones de diseño |
| [Funcionalidades](docs/features.md) | Evaluación, resultados, SoA, evidencia y registro de riesgos |
| [Multi-tenant](docs/tenancy.md) | Cómo se aíslan las organizaciones, roles, invitaciones y organización activa |
| [Seguridad](docs/security.md) | Autenticación, MFA, contraseñas, sesiones, CSP, archivos, cifrado y auditoría |
| [API](docs/api.md) | Todas las rutas, con permisos |
| [Operación](docs/operations.md) | Desarrollo local, variables de entorno, producción, migraciones y emails |
| [Pruebas](docs/testing.md) | Tests unitarios, de aislamiento y de punta a punta (Playwright), y CI |
| [Hoja de ruta](docs/ROADMAP.md) | Fases hechas y próximas |
| [Política de seguridad](SECURITY.md) | Cómo reportar una vulnerabilidad |
| [Términos y Condiciones](docs/legal/terminos-y-condiciones.md) · [Política de Privacidad](docs/legal/politica-de-privacidad.md) | Borradores legales (pendientes de revisión de un abogado) |

## Flujo de trabajo Git
- `main` protegida: solo entra por Pull Request con CI en verde.
- Ramas `feat/…`, `fix/…`, `docs/…`, `chore/…`, `test/…`.
- [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/): `feat(core): agrega ...`.
- Versionado semántico con tags `vX.Y.Z`.

## Nota sobre ISO
El repositorio incluye solo los **títulos** de los controles (traducidos). El texto de la norma está protegido por ISO: para mostrar guías o requisitos completos hay que adquirir la licencia correspondiente o redactar contenido propio.

## Licencia
Este proyecto es propietario. Todos los derechos reservados.

No se permite el uso, copia, modificación, distribución o explotación comercial sin autorización expresa y por escrito del titular.

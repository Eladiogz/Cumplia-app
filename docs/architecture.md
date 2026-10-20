# Arquitectura

## Monorepo
TypeScript con pnpm workspaces:

| Paquete | Qué es |
|---|---|
| `apps/web` | Frontend: Next.js 16 (App Router) + Tailwind 4 + componentes estilo shadcn/ui |
| `apps/api` | Backend: Fastify 5. Reglas de negocio, permisos, sesiones, emails, reportes PDF/Excel |
| `apps/e2e` | Pruebas de punta a punta con Playwright (ver [Pruebas](testing.md)) |
| `packages/db` | PostgreSQL con Drizzle ORM: esquema, migraciones versionadas y repositorio acotado por organización |
| `packages/core` | Lógica pura compartida por la API y la web: puntaje de madurez, SoA, riesgos, política de contraseñas |
| `packages/frameworks` | Marcos normativos como datos versionados (hoy: los 93 controles del Anexo A de ISO/IEC 27001:2022) |

## Flujo de una petición
```
Navegador ──► Web (Next.js, :3001) ──/api/*──► API (Fastify, :3000) ──► PostgreSQL (RLS)
                │                                 ├──► Almacenamiento S3 (evidencia)
                │                                 └──► Cola de emails ──► SMTP
                └── páginas (render por petición, CSP con nonce)
```
- El navegador **solo habla con la web**. La web reenvía `/api/*` a la API (rewrite de Next.js): mismo origen, sin CORS, y la cookie de sesión `httpOnly` viaja sola.
- La API confía en `X-Forwarded-For` solo si viene del proxy (`TRUST_PROXY`). El proxy `/api` de Next.js **reenvía esa cabecera tal como llega y no agrega la IP del cliente**: por eso, en producción, delante de la web tiene que haber un **proxy inverso** que agregue la IP real (ver [Operación](operations.md#producción)). Sin él, los límites por IP no distinguen clientes y la IP se puede falsificar.
- **Quien decide siempre es la API**: la web solo muestra u oculta controles según el rol.

## Datos
- Tablas de negocio con `organization_id` (evaluaciones, respuestas, evidencia, riesgos, invitaciones, auditoría): aisladas con Row-Level Security. Ver [Multi-tenant](tenancy.md).
- Tablas de identidad (`users`, `memberships`, `sessions`, `mfa_challenges`, `user_tokens`) y de sistema (`email_outbox`): sin RLS, se consultan antes de conocer la organización.
- Migraciones en `packages/db/drizzle` (generadas con drizzle-kit y completadas a mano cuando hace falta: RLS, permisos, FK por columna). Corren con el **dueño** de las tablas; la API se conecta con un rol **sin privilegios**.

## Decisiones de diseño
| Decisión | Por qué |
|---|---|
| Sesiones en el servidor (no JWT) | Se revocan al instante; el rol se lee en cada petición, un cambio rige ya |
| Proxy `/api` en la web | Mismo origen: cookies `SameSite`, sin CORS, CSRF acotado al `Origin` |
| Lógica en `packages/core` | Las mismas reglas validan en la API y guían en la web (contraseñas, riesgos, puntaje) |
| Render por petición | Cada página lleva su nonce de CSP; el tema llega por cookie sin parpadeo |
| Cola de emails (outbox) en Postgres | Un SMTP caído no pierde emails; sin infraestructura extra |
| Reportes generados en el servidor | PDF (pdfkit) y Excel (write-excel-file) desde los mismos datos que valida la API |
| Gráficos en HTML/CSS propios | Sin librerías pesadas; tooltip con teclado y vista de tabla accesible |

## Motores de cálculo (`packages/core`)
- **Madurez**: escala 0-4. El puntaje se calcula **sobre lo ya evaluado** (los pendientes no cuentan como 0) y `coverage` indica cuánto se evaluó. Las brechas se ordenan de la más grande a la más chica.
- **SoA**: por cada control, si aplica, justificación, estado de implementación y evidencias (ISO/IEC 27001 6.1.3 d).
- **Riesgos**: probabilidad × impacto (5×5) → Bajo ≤ 4 · Medio ≤ 9 · Alto ≤ 16 · Crítico > 16, más reglas de coherencia (aceptar exige justificación).
- **Contraseñas**: composición, longitud, datos personales y listas de contraseñas comunes/filtradas (sin servicios externos).

## Interfaz
- Tema claro, oscuro o según el sistema: cookie `cumplia_theme`, todos los colores como variables en `apps/web/src/app/globals.css`.
- Gráficos con contraste validado en ambos temas, tooltip con mouse y teclado, y vista de tabla equivalente; las severidades siempre con ícono + etiqueta.

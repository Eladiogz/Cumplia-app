# Seguridad

Cumplia guarda información sensible de cumplimiento de sus clientes: la seguridad es requisito de diseño. El aislamiento entre organizaciones está en [Multi-tenant](tenancy.md); para reportar una vulnerabilidad, ver [SECURITY.md](../SECURITY.md).

## Autenticación y sesiones
- Sesiones en el servidor con cookie `httpOnly` + `SameSite=Lax` (y `Secure` en producción o si la web es `https://`). En la base solo se guarda el **hash** del token (256 bits aleatorios): una filtración de la base no permite secuestrar sesiones, y se pueden revocar al instante.
- Una sesión vence a los **7 días** o tras **12 horas sin uso**, lo que ocurra primero: una computadora compartida u olvidada no queda abierta.
- Contraseñas con **scrypt** (N=2^16).
- Bloqueo de cuenta tras **5 intentos fallidos** (15 minutos, con aviso por email). El error es idéntico para usuario inexistente y clave incorrecta.
- Límite de peticiones por IP: 10/minuto en registro, ingreso y MFA; 100/minuto en el resto (configurables). **Requiere un proxy inverso delante de la web que agregue la IP real** (ver [Operación](operations.md#producción)).
- **CSRF**: además de `SameSite`, las peticiones que modifican datos desde un `Origin` que no está en `APP_ORIGIN` se rechazan (403).
- **Sesiones activas**: cada sesión guarda el navegador y la IP con que se abrió, y su última actividad (actualizada como mucho cada 5 minutos). Solo la propia persona las ve; puede cerrar una o todas las demás. Se borran al vencer.
- Auditoría de altas, accesos correctos, fallidos y cierres de sesión.

## Política de contraseñas
Definida una sola vez en `@cumplia/core/password` (la web guía con medidor y lista de requisitos; la API la aplica):
- Entre 12 y 128 caracteres, con **mayúscula, minúscula, número y carácter especial**.
- Sin el mismo carácter 4 veces seguidas.
- Sin datos de la persona: email, nombre, organización ni «Cumplia».
- **No puede ser común ni filtrada**: lista local con las 10.000 más usadas en filtraciones (SecLists) + términos frecuentes en español, detectadas aunque tengan relleno o leetspeak (`P@ssw0rd2024!` → `password`). Sin servicios externos.
- La API responde 400 `WEAK_PASSWORD` con las reglas que fallaron.

## Recuperación y verificación de email
- El link de restablecimiento vence a los **30 minutos**, sirve una vez y solo vale el último enviado. La contraseña nueva se valida antes de gastar el link. Al restablecer se cierran **todas** las sesiones, se desbloquea la cuenta y **se sigue pidiendo MFA**.
- "Olvidé mi contraseña" responde siempre lo mismo: no revela si la cuenta existe.
- Cambiar la contraseña exige la actual y cierra las otras sesiones. Ambos casos avisan por email y quedan en la auditoría de cada organización de la persona.
- El registro envía un link de confirmación (24 h). Sin confirmar se puede usar Cumplia, pero no invitar ni exportar.
- Los tokens van en el fragmento de la URL (`#token=…`): no llegan a ningún servidor ni al `Referer`. En la base solo queda su hash.

## Doble factor (MFA)
- TOTP compatible con Google Authenticator, Microsoft Authenticator, 1Password, etc. El QR se genera en el navegador.
- Con MFA activo, el ingreso responde `mfaRequired` y una cookie de desafío (5 minutos, solo para `/auth/mfa`) que **no** sirve como sesión.
- El secreto se guarda cifrado con **AES-256-GCM** (`MFA_ENCRYPTION_KEY`, fuera de la base, con el usuario como dato autenticado); los 10 códigos de recuperación, solo como hash y se muestran una sola vez.
- Un código TOTP no se acepta dos veces; los fallos cuentan para el mismo bloqueo que la contraseña.
- Al activar MFA se cierran las demás sesiones. No se puede desactivar si alguna de sus organizaciones lo exige.
- Avisos por email: MFA activado, desactivado, ingreso con código de recuperación y cuenta bloqueada.

## Navegador: Content Security Policy
- `apps/web/src/proxy.ts` genera un **nonce aleatorio por página** y solo corren los `<script>` que lo traen (`'strict-dynamic'`, sin `unsafe-inline` ni `unsafe-eval` en producción). Un script inyectado por XSS no conoce el nonce y el navegador lo bloquea.
- Además: `object-src 'none'`, `frame-ancestors 'none'`, `base-uri` y `form-action 'self'`, y datos solo hacia el mismo origen. Los atributos `style="…"` se permiten (`style-src-attr`): no ejecutan código.
- Cabeceras: `Strict-Transport-Security`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` sin cámara, micrófono ni ubicación. La API usa helmet.

## Archivos de evidencia
- Solo **PNG, JPG, WebP y PDF**, hasta **10 MB**. El tipo se detecta por el **contenido** (firma del archivo): un SVG o HTML disfrazado de imagen se rechaza.
- La clave de cada archivo la arma la API bajo `org/<organización>/…`; el nombre que puso el usuario solo se muestra (saneado).
- Solo se descargan **a través de la API** (que verifica organización y rol), con `nosniff`, CSP `sandbox` y sin caché compartida.
- Huella **SHA-256** de cada archivo para demostrar que no cambió.
- En producción, con AWS S3, cifrado del lado del servidor (`S3_SSE=AES256`).

## Datos e inyecciones
- Todas las entradas se validan con esquemas (zod) en la API; las consultas van parametrizadas (Drizzle).
- Excel: los textos de los usuarios siempre como celdas de **texto** (sin inyección de fórmulas).
- Emails: los datos de los usuarios se escapan en el HTML. Los nombres de organización y de personas (que aparecen en los emails) **no pueden contener links**, y cada organización puede enviar como mucho **20 invitaciones por hora**: Cumplia no sirve para mandar spam o phishing desde su dominio.
- Cola de emails: el contenido (con links y tokens) se guarda **cifrado** (AES-256-GCM, clave derivada con HKDF y atada a cada fila) y se borra al enviarse.

## Auditoría
- Cada cambio de datos de negocio deja un registro en la misma transacción, con detalle (p. ej. rol anterior y nuevo), **nunca secretos**.
- `audit_logs` es inalterable: un trigger impide modificarla o borrarla y el rol de la API no tiene esos permisos. **Única excepción:** eliminar la organización completa (ver abajo), que lo hace una función de la base y deja constancia en `organization_deletions`.

## Derechos sobre los datos (Ley 25.326)
- **Rectificación**: cada persona corrige su nombre (`PATCH /auth/me`); sin links, como en el registro.
- **Supresión de la cuenta** (`POST /auth/account/delete`): exige escribir el email, la contraseña y, con MFA, un código (una sesión robada no alcanza; los fallos cuentan para el bloqueo). Nunca deja una organización sin ADMIN. Borra la cuenta y, en cascada, membresías, sesiones, tokens y MFA. En la auditoría de cada organización queda `user.account_deleted`.
- **Portabilidad** (`GET /organization/export`): ZIP con todos los datos de la organización en JSON y los archivos de evidencia. Solo ADMIN con email verificado; auditado. Nunca incluye hashes de tokens, contraseñas, secretos MFA ni claves internas de archivos.
- **Supresión de la organización** (`POST /organization/delete`): ADMIN; exige el nombre exacto, la contraseña y, con MFA, un código. Borra primero los archivos del almacenamiento (si falla, la organización sigue entera) y después todo en una transacción con `app_purge_organization` (`SECURITY DEFINER`). La función solo acepta la organización fijada en la transacción (la de la sesión): un error en la API no puede borrar otra. También borra las cuentas que quedan sin ninguna organización (no podrían volver a ingresar). Avisa por email a todos los miembros.
- Límite de 10 por minuto por IP (como el ingreso) en eliminar y exportar.

## Cadena de suministro
- Dependencias con versión fijada y `pnpm install --frozen-lockfile` en CI; `pnpm audit` en cada build (las dependencias de producción, sin vulnerabilidades conocidas).
- Quedan dos avisos en herramientas de **desarrollo** que no llegan a producción: `braces` (vía el plugin de ESLint de Next, sin parche publicado; solo afecta al lint) y `esbuild` dentro de drizzle-kit (afecta a su servidor de desarrollo, que no se usa).
- CodeQL y Dependabot en GitHub.
- Sin secretos en el repositorio (`.env` ignorado).

# Multi-tenant: aislamiento entre organizaciones

Cada cliente es una **organización**. Una cuenta puede pertenecer a varias (p. ej. un consultor con varios clientes), pero en cada momento trabaja en **una** (la organización activa de su sesión).

## Las capas de aislamiento
1. **Código**: todo acceso a datos de negocio pasa por `forOrganization(db, orgId)`. Cada consulta filtra por organización y un recurso ajeno responde **404** (no revela que existe).
2. **Base de datos**: FK compuestas `(id, organization_id)` entre evaluaciones, respuestas y evidencia; sesiones y desafíos MFA atados a la membresía `(user_id, organization_id)`; el responsable de un riesgo atado a la membresía de la misma organización. La base rechaza cualquier fila que mezcle organizaciones.
3. **Row-Level Security**: en `assessments`, `control_answers`, `evidence`, `invitations`, `risks` y `audit_logs`, Postgres solo devuelve y deja escribir filas de la organización fijada en la transacción (`forOrganization` lo hace siempre, con `set_config(..., true)`: no se filtra a la petición siguiente del pool). Sin organización activa: ninguna fila.
4. **Rol sin privilegios**: la API se conecta con un usuario del rol `cumplia_app`, sin privilegios de dueño. **En producción se niega a arrancar** si la conexión se saltearía RLS (superusuario, `BYPASSRLS` o dueño de las tablas).
5. **Auditoría inalterable**: un trigger impide `UPDATE`, `DELETE` y `TRUNCATE` sobre `audit_logs`, y el rol de la API ni siquiera tiene esos permisos.
6. **Tests que se mantienen solos**: `tenant-isolation.test.ts` descubre **todas** las rutas protegidas y verifica que una organización no pueda leer ni modificar datos de otra; otro test exige RLS en toda tabla nueva con `organization_id`. Las pruebas de punta a punta repiten el ataque desde el navegador. Ver [Pruebas](testing.md).

Las tablas de identidad (`users`, `sessions`, `mfa_challenges`, `memberships`) no tienen RLS: se consultan antes de saber la organización (login, cookie). Su aislamiento lo dan las FK a la membresía y el código.

Los archivos de evidencia se guardan bajo `org/<organización>/…` y solo se descargan a través de la API, que verifica la organización.

## Roles
| Rol | Puede |
|---|---|
| **ADMIN** | Todo: organización, miembros, invitaciones, evaluaciones, riesgos (incluido borrar), auditoría |
| **CONSULTANT** | Trabajar evaluaciones (respuestas, evidencia) y riesgos; no administra, no borra riesgos, no ve auditoría |
| **AUDITOR** | Solo lectura, incluidas auditoría y revisión de accesos (miembros) |

- La matriz vive en `apps/api/src/security/permissions.ts`; lo que no figura se deniega. Cada ruta protegida declara su permiso y, si alguna no lo hace, **la API no arranca**.
- El rol se lee en cada petición: un cambio o una baja rigen al instante.
- Una organización nunca puede quedar sin ADMIN.
- Con `requireMfa` activo, quien no tenga MFA solo puede iniciar sesión y configurarlo (el resto responde 403 `MFA_SETUP_REQUIRED`). Para activarlo, el ADMIN tiene que tener MFA.

## Invitaciones
- El ADMIN invita por email con un rol (exige email confirmado). El token viaja **solo** en el email (`/invitaciones/aceptar#token=…`, en el fragmento: no llega a ningún servidor ni al `Referer`). Ni el ADMIN que invita lo ve.
- Vence a los 7 días, sirve una vez y en la base solo queda el hash. Reinvitar al mismo email invalida el link anterior.
- El email lo fija la invitación: un link reenviado no sirve para otra cuenta. Si el email ya tiene cuenta, hay que iniciar sesión para aceptar (se respetan su contraseña y su MFA). Las cuentas creadas por invitación ya vienen verificadas.
- La tabla `invitations` tiene RLS: la organización ve las suyas y quien acepta solo puede **leer** la invitación cuyo token presenta.
- El email sale por la [cola de emails](operations.md#emails): si el SMTP falla, se reintenta.

## Organización activa
- Al iniciar sesión se entra a la última organización usada (si sigue siendo miembro; si no, a la primera).
- Cambiar de organización (o aceptar una invitación con sesión) **rota la sesión**: la anterior se cierra y la nueva queda atada a la membresía elegida.

## Acciones del ADMIN sobre un miembro (seguras para multi-tenant)
El ADMIN de una organización **nunca** toca la contraseña ni debilita el acceso de la persona en sus otras organizaciones:
- **Restablecer contraseña**: le envía un link para que **la persona** elija una nueva (el ADMIN no la ve ni la fija).
- **Cerrar sesiones**: solo **en esta organización**.
- **Restablecer MFA**: solo si la cuenta pertenece **únicamente** a esta organización, y solo si el ADMIN tiene MFA activo.

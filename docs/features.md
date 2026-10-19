# Funcionalidades

## Asistente de evaluación (`/evaluaciones/:id`)
- Los 93 controles del Anexo A de ISO/IEC 27001:2022 agrupados por dominio, con avance por dominio.
- Por control: **aplica / no aplica** (con justificación obligatoria si no aplica), **madurez 0-4** con la descripción de cada nivel, notas y evidencia.
- Guardado automático por control (una cola por control: nunca gana una respuesta vieja).
- ADMIN y CONSULTANT editan; AUDITOR ve en modo lectura.
- `?control=A.5.1` abre ese control (lo usan los links de las brechas).

## Resultado y tablero (`/evaluaciones/:id/resultado`)
- Cifra principal (puntaje sobre lo evaluado) e indicadores: controles que alcanzan el objetivo, brechas, aplicables, pendientes.
- Madurez por dominio (barras con la línea del objetivo) y controles por nivel (escala ordinal de un solo tono).
- Tabla de **brechas priorizadas** con link a cada control en el asistente.
- Cada gráfico tiene tooltip (mouse y teclado) y **vista de tabla** equivalente.

## Declaración de Aplicabilidad (SoA)
- **PDF** (A4 apaisado, para firmar y presentar) y **Excel** (hojas Resumen, Declaración de Aplicabilidad filtrable y Brechas).
- Por cada control: título, si aplica, **justificación de inclusión o exclusión**, estado de implementación (madurez) y cantidad de evidencias.
- Exige email confirmado; cada exportación queda en la auditoría (`soa.export`).
- Los textos de los usuarios se escriben en el Excel como **texto**: nunca se interpretan como fórmulas.

## Evidencia
- Texto o archivo: imágenes **PNG, JPG, WebP** y **PDF**, hasta **10 MB**. El tipo se verifica por el **contenido**, no por la extensión.
- Cada archivo guarda su **huella SHA-256**: permite demostrar ante un auditor que no cambió desde que se cargó.
- Se guardan en un almacenamiento compatible con S3 y se descargan solo a través de la API (ver [Seguridad](security.md#archivos-de-evidencia)).

## Registro de riesgos (`/riesgos`)
Evaluación y tratamiento de riesgos (ISO/IEC 27001 cláusulas 6.1.2 y 6.1.3):
- **Matriz 5×5**: probabilidad (Rara → Casi segura) × impacto (Insignificante → Catastrófico). Puntaje 1-25 → **Bajo** ≤ 4 · **Medio** ≤ 9 · **Alto** ≤ 16 · **Crítico** > 16.
- Cada riesgo: código correlativo por organización (R-001…), activo, amenaza, tratamiento (mitigar, aceptar, transferir, evitar) con su plan, controles del Anexo A, **riesgo residual**, estado, responsable y fecha límite.
- **Aceptar exige justificación**, y el estado *Aceptado* solo vale con tratamiento *Aceptar*. Se valida sobre el resultado de cada cambio (también en un PATCH parcial).
- El responsable debe ser miembro de la organización; si la deja, el riesgo queda sin responsable (no se pierde).
- **Mapa de calor** inherente/residual: tooltip con mouse y teclado, clic en una celda para filtrar, vista de tabla. Los riesgos abiertos con la fecha límite vencida se marcan.
- Exportación a **Excel** (Resumen con la matriz y tabla filtrable), con email confirmado.
- ADMIN y CONSULTANT registran y editan; solo ADMIN borra; AUDITOR lee.

## Organización y cuenta
- **Organización** (`/organizacion`): nombre, exigir MFA a todos, miembros y roles, invitaciones.
- **Seguridad** (`/seguridad`): MFA, códigos de recuperación, cambio de contraseña y **sesiones activas** (dispositivo, IP, última actividad; cerrar una o todas las demás).
- **Tema** claro, oscuro o según el sistema, desde el menú de usuario.

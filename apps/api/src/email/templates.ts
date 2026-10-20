import type { Role } from "@cumplia/db";
import type { EmailMessage } from "./mailer.js";

// Plantillas en español. Todo dato que viene de usuarios (nombres de organización,
// personas) se escapa en el HTML y se limpia de saltos de línea en el asunto.

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrador/a",
  CONSULTANT: "Consultor/a",
  AUDITOR: "Auditor/a",
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

const formatDate = (d: Date) =>
  d.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const SIGNATURE = "— Cumplia";

const NAVY = "#1f3a5f";
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * HTML de email con la identidad de Cumplia: tablas y estilos en línea (lo único que
 * respetan todos los clientes de correo), sin imágenes externas (no se bloquean y no
 * permiten rastrear la apertura). Todo texto llega ya escapado.
 */
function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#eef2f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT}">
<tr><td style="background:${NAVY};border-radius:10px 10px 0 0;padding:18px 28px">
<span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px">Cumplia</span>
</td></tr>
<tr><td style="background:#ffffff;padding:28px;color:#1f2937;font-size:15px;line-height:1.55">
${body}
</td></tr>
<tr><td style="padding:16px 28px;color:#6b7280;font-size:12px;line-height:1.5;text-align:center">
Cumplimiento sin planillas · Recibiste este email por tu cuenta en Cumplia.<br>Nunca te vamos a pedir tu contraseña ni tus códigos por email.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** Arma texto plano y HTML a partir de párrafos (todo se escapa; el botón lleva una URL nuestra). */
function message(to: string, subject: string, paragraphs: string[], action?: { label: string; url: string }): EmailMessage {
  const text = [...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : []), SIGNATURE].join("\n\n");
  const button = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="background:${NAVY};border-radius:6px">
<a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none">${escapeHtml(action.label)}</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:12px;color:#6b7280">Si el botón no funciona, copiá este link en tu navegador:<br><span style="word-break:break-all;color:${NAVY}">${escapeHtml(action.url)}</span></p>`
    : "";
  const [first, ...rest] = paragraphs;
  const body = [
    ...(first ? [`<p style="margin:0 0 16px">${escapeHtml(first)}</p>`] : []),
    // El botón va después del primer párrafo: es la acción principal del email.
    button,
    ...rest.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`),
    `<p style="margin:24px 0 0;color:#6b7280">${SIGNATURE}</p>`,
  ].join("\n");
  return { to, subject: oneLine(subject), text, html: layout(escapeHtml(oneLine(subject)), body) };
}

const SECURITY_FOOTER = "Si no fuiste vos, cambiá tu contraseña y avisale al administrador de tu organización.";

export function invitationEmail(input: {
  to: string;
  organizationName: string;
  invitedBy: string;
  role: Role;
  url: string;
  expiresAt: Date;
}) {
  return message(
    input.to,
    `Te invitaron a ${input.organizationName} en Cumplia`,
    [
      `${input.invitedBy} te invitó a sumarte a ${input.organizationName} en Cumplia con el rol ${ROLE_LABEL[input.role]}.`,
      `La invitación vence el ${formatDate(input.expiresAt)} y sirve una sola vez.`,
      "Si no esperabas este email, podés ignorarlo.",
    ],
    { label: "Aceptar la invitación", url: input.url },
  );
}

export const mfaEnabledEmail = (to: string) =>
  message(to, "Activaste la verificación en dos pasos", [
    "La verificación en dos pasos (MFA) quedó activa en tu cuenta de Cumplia. Guardá tus códigos de recuperación en un lugar seguro.",
    SECURITY_FOOTER,
  ]);

export const mfaDisabledEmail = (to: string) =>
  message(to, "Se desactivó la verificación en dos pasos", [
    "La verificación en dos pasos (MFA) se desactivó en tu cuenta de Cumplia. Tu cuenta ahora depende solo de la contraseña.",
    SECURITY_FOOTER,
  ]);

export const recoveryCodeUsedEmail = (to: string, remaining: number) =>
  message(to, "Se usó un código de recuperación", [
    `Se inició sesión en tu cuenta de Cumplia con un código de recuperación. Te quedan ${remaining}.`,
    ...(remaining <= 3 ? ["Te quedan pocos: generá códigos nuevos desde la configuración de seguridad de tu cuenta."] : []),
    SECURITY_FOOTER,
  ]);

export const verifyEmailEmail = (to: string, url: string) =>
  message(
    to,
    "Confirmá tu email en Cumplia",
    [
      "Para terminar de activar tu cuenta de Cumplia, confirmá que este email es tuyo.",
      "El link vence en 24 horas. Si no creaste una cuenta, ignorá este mensaje.",
    ],
    { label: "Confirmar mi email", url },
  );

export function passwordResetEmail(input: { to: string; url: string; minutes: number; requestedByOrganization?: string }) {
  return message(
    input.to,
    "Restablecé tu contraseña de Cumplia",
    [
      input.requestedByOrganization
        ? `Un administrador de ${input.requestedByOrganization} pidió que restablezcas tu contraseña de Cumplia.`
        : "Recibimos un pedido para restablecer la contraseña de tu cuenta de Cumplia.",
      `El link vence en ${input.minutes} minutos y sirve una sola vez. Tu contraseña actual sigue funcionando hasta que elijas una nueva.`,
      "Si no lo pediste, ignorá este email: nadie puede cambiar tu contraseña sin este link.",
    ],
    { label: "Elegir una contraseña nueva", url: input.url },
  );
}

export const passwordChangedEmail = (to: string) =>
  message(to, "Tu contraseña cambió", [
    "La contraseña de tu cuenta de Cumplia se cambió y cerramos las otras sesiones abiertas.",
    "Si no fuiste vos, restablecela ahora desde «¿Olvidaste tu contraseña?» y avisale al administrador de tu organización.",
  ]);

export const mfaResetByAdminEmail = (to: string, organizationName: string) =>
  message(to, "Un administrador restableció tu verificación en dos pasos", [
    `Un administrador de ${organizationName} restableció la verificación en dos pasos (MFA) de tu cuenta y cerró tus sesiones.`,
    "La próxima vez que ingreses vas a poder (o tener que) configurarla de nuevo con tu app de autenticación.",
    SECURITY_FOOTER,
  ]);

export const accountLockedEmail = (to: string, minutes: number) =>
  message(to, "Bloqueamos tu cuenta temporalmente", [
    `Hubo varios intentos fallidos de iniciar sesión en tu cuenta de Cumplia, así que la bloqueamos por ${minutes} minutos.`,
    "Si fuiste vos, esperá y volvé a intentar. Si no, alguien podría estar intentando adivinar tu contraseña: cambiala en cuanto puedas.",
  ]);

/**
 * Link a una pantalla de la web con un token de un solo uso. El token va en el
 * fragmento (#): el navegador no lo manda a ningún servidor ni en el Referer.
 */
export const appLink = (appUrl: string, path: string, token: string) =>
  `${appUrl.replace(/\/$/, "")}${path}#token=${encodeURIComponent(token)}`;

export const PASSWORD_RESET_PATH = "/restablecer";
export const VERIFY_EMAIL_PATH = "/verificar-email";
export const ACCEPT_INVITATION_PATH = "/invitaciones/aceptar";

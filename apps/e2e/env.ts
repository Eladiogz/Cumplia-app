/**
 * Entorno de las pruebas de punta a punta. Todo es configurable por variables de
 * entorno; los valores por defecto sirven con `docker compose up -d db mail`.
 */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 3200);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3201);
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

/** Base TEMPORAL: se borra y se crea de cero en cada corrida. Nunca la de desarrollo. */
export const DB_NAME = process.env.E2E_DB_NAME ?? "cumplia_e2e_pw";
/** Conexión del dueño (crea la base y migra). */
export const ADMIN_DATABASE_URL = process.env.E2E_ADMIN_DATABASE_URL ?? "postgresql://cumplia:cumplia@localhost:5432/cumplia";

const withDatabase = (url: string, db: string, credentials?: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (credentials) {
    const [user, password] = credentials.split(":");
    u.username = user!;
    u.password = password!;
  }
  return u.toString();
};
export const MIGRATION_DATABASE_URL = withDatabase(ADMIN_DATABASE_URL, DB_NAME);
/** La API se conecta con el rol sin privilegios (RLS se aplica), como en producción. */
export const API_DATABASE_URL = withDatabase(ADMIN_DATABASE_URL, DB_NAME, "cumplia_api:cumplia_api");

export const SMTP_URL = process.env.E2E_SMTP_URL ?? "smtp://localhost:1025";
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://localhost:8025";

/** Clave fija solo para pruebas (32 bytes en base64). */
export const MFA_ENCRYPTION_KEY = "ZTJlLXNvbG8tcHJ1ZWJhcy1ub3VzYXItZW4tcHJvZCE=";

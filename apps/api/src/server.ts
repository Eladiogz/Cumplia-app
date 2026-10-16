import { createDb, rowLevelSecurityBypassReasons } from "@cumplia/db";
import { buildApp } from "./app.js";
import { createSmtpMailer } from "./email/mailer.js";
import { parseEncryptionKey } from "./security/encryption.js";
import { createDevTenantResolver, createSessionTenantResolver, firstOf } from "./tenant.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

const mfaKey = process.env.MFA_ENCRYPTION_KEY;
if (!mfaKey) throw new Error("Falta MFA_ENCRYPTION_KEY (generala con: openssl rand -base64 32)");
const mfaEncryptionKey = parseEncryptionKey(mfaKey);

const isProd = process.env.NODE_ENV === "production";
const { db, pool } = createDb(url);

// RLS no se aplica a superusuarios ni al dueño de las tablas: en producción eso
// dejaría el aislamiento entre organizaciones solo en manos del código.
const rlsBypass = await rowLevelSecurityBypassReasons(db);
if (rlsBypass.length > 0) {
  const msg = `Row-Level Security NO se aplica a esta conexión (${rlsBypass.join("; ")}). Conectá la API con un usuario del rol cumplia_app.`;
  if (isProd) throw new Error(msg);
  console.warn(`ADVERTENCIA: ${msg}`);
}

// Emails: en producción es obligatorio un SMTP real (las invitaciones dependen de él).
// En desarrollo, Mailpit (docker compose) o, si no hay SMTP_URL, el log de la API.
const smtpUrl = process.env.SMTP_URL;
if (isProd && !smtpUrl) throw new Error("Falta SMTP_URL: en producción los emails deben enviarse de verdad");
const mailer = smtpUrl ? createSmtpMailer(smtpUrl, process.env.MAIL_FROM ?? "Cumplia <no-reply@cumplia.local>") : undefined;
if (!mailer) console.warn("ADVERTENCIA: sin SMTP_URL, los emails (con sus links) se escriben en el log.");

// El resolver de desarrollo jamás se activa en producción.
const devTenant = process.env.ALLOW_DEV_TENANT_HEADER === "true" && !isProd;
const session = createSessionTenantResolver(db);
const allowedOrigins = (process.env.APP_ORIGIN ?? "http://localhost:3001").split(",").map((o) => o.trim());

const app = buildApp({
  db,
  resolveTenant: devTenant ? firstOf(session, createDevTenantResolver(db)) : session,
  secureCookies: isProd,
  mfaEncryptionKey,
  allowedOrigins,
  mailer,
  appUrl: process.env.APP_URL ?? allowedOrigins[0],
});
app.addHook("onClose", async () => {
  await pool.end();
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

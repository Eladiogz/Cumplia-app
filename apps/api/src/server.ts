import { createDb, rowLevelSecurityBypassReasons } from "@cumplia/db";
import { buildApp } from "./app.js";
import { createLogMailer, createSmtpMailer } from "./email/mailer.js";
import { createOutbox, deriveOutboxKey } from "./email/outbox.js";
import { createS3Storage } from "./storage/storage.js";
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
const smtp = smtpUrl ? createSmtpMailer(smtpUrl, process.env.MAIL_FROM ?? "Cumplia <no-reply@cumplia.local>") : undefined;
if (!smtp) console.warn("ADVERTENCIA: sin SMTP_URL, los emails (con sus links) se escriben en el log.");
// Todo email pasa por la cola (cifrado en la base): si el SMTP falla, se reintenta.
const outbox = createOutbox({
  db,
  key: deriveOutboxKey(mfaEncryptionKey),
  transport: smtp ?? { send: (message) => createLogMailer(app.log).send(message) },
  onError: ({ id, attempts, error, final }) =>
    app.log[final ? "error" : "warn"]({ emailId: id, attempts, error }, final ? "Email descartado tras reintentos" : "Email no enviado, se reintentará"),
});

// Archivos de evidencia en un almacenamiento S3 (AWS, R2, Backblaze; SeaweedFS en desarrollo).
const s3Bucket = process.env.S3_BUCKET;
if (isProd && !s3Bucket) throw new Error("Falta S3_BUCKET: en producción la evidencia con archivos necesita almacenamiento");
let storage: ReturnType<typeof createS3Storage> | undefined;
if (s3Bucket) {
  const { S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error("Faltan S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY");
  storage = createS3Storage({
    bucket: s3Bucket,
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    serverSideEncryption: process.env.S3_SSE === "AES256" ? "AES256" : undefined,
  });
  // En desarrollo se crea el bucket si falta; en producción tiene que existir.
  await storage.ensureBucket(!isProd);
} else {
  console.warn("ADVERTENCIA: sin S3_BUCKET, la carga de archivos de evidencia está deshabilitada.");
}

// El resolver de desarrollo jamás se activa en producción.
const devTenant = process.env.ALLOW_DEV_TENANT_HEADER === "true" && !isProd;
const session = createSessionTenantResolver(db);
const allowedOrigins = (process.env.APP_ORIGIN ?? "http://localhost:3001").split(",").map((o) => o.trim());

/** Límite opcional por variable de entorno (entero positivo); si no, el valor por defecto de la app. */
const positiveInt = (name: string): number | undefined => {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} debe ser un entero positivo`);
  return n;
};

/** TRUST_PROXY: IPs/CIDR del proxy separadas por coma (recomendado), o true/false. */
const parseTrustProxy = (value: string | undefined): boolean | string => {
  if (!value || value === "false") return false;
  return value === "true" ? true : value;
};

const app = buildApp({
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  publicPathPrefix: process.env.API_PUBLIC_PREFIX ?? "",
  db,
  resolveTenant: devTenant ? firstOf(session, createDevTenantResolver(db)) : session,
  secureCookies: isProd,
  // Por IP y por minuto. Por defecto 10 (ingreso/registro/MFA) y 100 (resto); las pruebas E2E los suben.
  authRateLimit: positiveInt("AUTH_RATE_LIMIT"),
  apiRateLimit: positiveInt("API_RATE_LIMIT"),
  mfaEncryptionKey,
  allowedOrigins,
  mailer: outbox.mailer,
  appUrl: process.env.APP_URL ?? allowedOrigins[0],
  storage,
});
app.addHook("onClose", async () => {
  await outbox.stop();
  await pool.end();
});

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    outbox.start(); // reintentos y emails que quedaron pendientes de un arranque anterior
    void outbox.flush();
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

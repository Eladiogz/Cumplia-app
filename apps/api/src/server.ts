import { createDb } from "@cumplia/db";
import { buildApp } from "./app.js";
import { createDevTenantResolver, createSessionTenantResolver, firstOf } from "./tenant.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

const isProd = process.env.NODE_ENV === "production";
const { db, pool } = createDb(url);

// El resolver de desarrollo jamás se activa en producción.
const devTenant = process.env.ALLOW_DEV_TENANT_HEADER === "true" && !isProd;
const session = createSessionTenantResolver(db);

const app = buildApp({
  db,
  resolveTenant: devTenant ? firstOf(session, createDevTenantResolver(db)) : session,
  secureCookies: isProd,
  allowedOrigins: (process.env.APP_ORIGIN ?? "http://localhost:3001").split(",").map((o) => o.trim()),
});
app.addHook("onClose", async () => {
  await pool.end();
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

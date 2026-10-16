import { createDb } from "@cumplia/db";
import { buildApp } from "./app.js";
import { createDevTenantResolver } from "./tenant.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

const { db, pool } = createDb(url);

// El resolver de desarrollo jamás se activa en producción.
const devTenant =
  process.env.ALLOW_DEV_TENANT_HEADER === "true" && process.env.NODE_ENV !== "production";

const app = buildApp({ db, resolveTenant: devTenant ? createDevTenantResolver(db) : () => null });
app.addHook("onClose", async () => {
  await pool.end();
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

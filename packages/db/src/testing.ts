import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER } from "./client.js";
import * as schema from "./schema.js";

/**
 * Postgres real en memoria (WASM) con las migraciones aplicadas. Solo para tests.
 * Las migraciones corren como superusuario y luego la conexión pasa al rol
 * `cumplia_app`, el mismo que usa la API: Row-Level Security se aplica de verdad.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await db.execute(sql`set role cumplia_app`);

  /** Ejecuta `fn` como dueño de las tablas (sin RLS), p. ej. para preparar datos o probar triggers. */
  const asOwner = async <T>(fn: () => Promise<T>) => {
    await db.execute(sql`reset role`);
    try {
      return await fn();
    } finally {
      await db.execute(sql`set role cumplia_app`);
    }
  };

  return { db, asOwner, close: () => client.close() };
}

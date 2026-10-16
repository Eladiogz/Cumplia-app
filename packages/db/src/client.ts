import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_FOLDER = new URL("../drizzle", import.meta.url).pathname;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

/**
 * Motivos por los que Row-Level Security NO se aplicaría a la conexión actual
 * (superusuario, BYPASSRLS o dueño de las tablas). Vacío = RLS efectivo.
 */
export async function rowLevelSecurityBypassReasons(db: Db): Promise<string[]> {
  type Row = { user: string; superuser: boolean; bypass: boolean; owner: boolean };
  // node-postgres y PGlite devuelven ambos `{ rows }`; el tipo genérico de Db no lo expresa.
  const { rows } = (await db.execute(sql`
    select current_user as user, r.rolsuper as superuser, r.rolbypassrls as bypass,
           pg_has_role(current_user, (select tableowner from pg_tables where schemaname = 'public' and tablename = 'assessments'), 'USAGE') as owner
    from pg_roles r where r.rolname = current_user`)) as unknown as { rows: Row[] };
  const r = rows[0];
  if (!r) return ["no se pudo identificar el rol de la conexión"];
  return [
    ...(r.superuser ? [`${r.user} es superusuario`] : []),
    ...(r.bypass ? [`${r.user} tiene BYPASSRLS`] : []),
    ...(r.owner ? [`${r.user} es (o hereda) el dueño de las tablas`] : []),
  ];
}

export async function runMigrations(db: ReturnType<typeof createDb>["db"]) {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

import { createDb, runMigrations } from "./client.js";

// Las migraciones corren con el DUEÑO de las tablas; la API, con un rol sin privilegios
// (DATABASE_URL) para que Row-Level Security se aplique.
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Falta MIGRATION_DATABASE_URL (o DATABASE_URL)");

const { db, pool } = createDb(url);
await runMigrations(db);
await pool.end();
console.log("Migraciones aplicadas");

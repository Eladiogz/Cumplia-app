import { createDb, runMigrations } from "./client.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

const { db, pool } = createDb(url);
await runMigrations(db);
await pool.end();
console.log("Migraciones aplicadas");

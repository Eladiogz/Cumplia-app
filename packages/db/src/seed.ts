import { createDb } from "./client.js";
import { createOrganization } from "./repository.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

const { db, pool } = createDb(url);
const org = await createOrganization(db, process.argv[2] ?? "Organización demo");
await pool.end();
console.log(`Organización creada. ID: ${org.id}`);

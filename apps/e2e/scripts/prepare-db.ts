/**
 * Base de datos de las pruebas E2E: la borra, la crea de cero, asegura los roles
 * (`cumplia_app` sin login y `cumplia_api` para la API) y aplica las migraciones.
 * Se niega a tocar algo que no sea la base temporal de E2E.
 */
import pg from "pg";
import { createDb, runMigrations } from "@cumplia/db";
import { ADMIN_DATABASE_URL, DB_NAME, MIGRATION_DATABASE_URL } from "../env.js";

if (!/e2e/.test(DB_NAME)) throw new Error(`Por seguridad, la base de E2E debe llevar "e2e" en el nombre (era ${DB_NAME})`);

const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
await admin.connect();
await admin.query(`drop database if exists "${DB_NAME}" with (force)`);
await admin.query(`create database "${DB_NAME}"`);
// En CI la base es nueva y no corre docker/postgres-init: los roles se crean acá (idempotente).
await admin.query(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'cumplia_app') then create role cumplia_app nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'cumplia_api') then
      create role cumplia_api login password 'cumplia_api' in role cumplia_app;
    end if;
  end $$`);
await admin.end();

const { db, pool } = createDb(MIGRATION_DATABASE_URL);
await runMigrations(db);
await pool.end();
console.log(`E2E: base ${DB_NAME} lista`);

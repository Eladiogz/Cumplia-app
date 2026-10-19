import { defineConfig, devices } from "@playwright/test";
import {
  API_DATABASE_URL,
  API_PORT,
  API_URL,
  MFA_ENCRYPTION_KEY,
  SMTP_URL,
  WEB_PORT,
  WEB_URL,
} from "./env.js";

const CI = !!process.env.CI;

/**
 * Pruebas de punta a punta: la web y la API reales (compiladas), Postgres con RLS y
 * Mailpit para leer los emails. Requisitos: `pnpm build` y `docker compose up -d db mail`.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: CI ? 2 : 3,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: CI,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_URL,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"] }, grepInvert: /@celular/ },
    { name: "celular", use: { ...devices["Pixel 7"] }, grep: /@celular/ },
  ],
  webServer: [
    {
      // Base de cero + API compilada, con el rol sin privilegios (RLS) como en producción.
      command: "pnpm exec tsx scripts/prepare-db.ts && node ../api/dist/server.js",
      url: `${API_URL}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        NODE_ENV: "development",
        DATABASE_URL: API_DATABASE_URL,
        PORT: String(API_PORT),
        APP_ORIGIN: WEB_URL,
        API_PUBLIC_PREFIX: "/api",
        TRUST_PROXY: "127.0.0.1,::1",
        MFA_ENCRYPTION_KEY,
        SMTP_URL,
        MAIL_FROM: "Cumplia E2E <e2e@cumplia.local>",
        // Todas las cuentas de prueba salen de la misma IP.
        AUTH_RATE_LIMIT: "1000",
        API_RATE_LIMIT: "10000",
      },
    },
    {
      // API_URL se fija al compilar la web (las rewrites de /api quedan en el build).
      command: `pnpm --filter @cumplia/web exec next build && pnpm --filter @cumplia/web exec next start -p ${WEB_PORT}`,
      url: `${WEB_URL}/ingresar`,
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      env: { API_URL },
    },
  ],
});

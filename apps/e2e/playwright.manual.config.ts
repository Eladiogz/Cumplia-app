import { defineConfig } from "@playwright/test";
import { WEB_URL } from "./env.js";
import { servers } from "./playwright.config.js";

/**
 * Capturas del manual de usuario (docs/manual/img). Recorre la app como un cliente nuevo,
 * en un entorno propio (puertos y base aparte; ver el script "manual" en package.json).
 * Requisitos: `pnpm build` y `docker compose up -d db mail files`.
 */
export default defineConfig({
  testDir: "./manual",
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: WEB_URL,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
  },
  webServer: servers({
    distDir: ".next-manual",
    // Con almacenamiento de archivos (SeaweedFS de docker compose) para mostrar la evidencia.
    apiEnv: {
      S3_BUCKET: "cumplia-manual",
      S3_REGION: "us-east-1",
      S3_ENDPOINT: "http://localhost:8333",
      S3_FORCE_PATH_STYLE: "true",
      S3_ACCESS_KEY_ID: "cumplia",
      S3_SECRET_ACCESS_KEY: "cumplia-dev-secret",
    },
  }),
});

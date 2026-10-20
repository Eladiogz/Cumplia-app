import { defineConfig } from "vitest/config";

// Cada archivo crea su Postgres en memoria (PGlite) y aplica todas las migraciones: con
// varios archivos en paralelo eso supera los 10 s por defecto de los hooks.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

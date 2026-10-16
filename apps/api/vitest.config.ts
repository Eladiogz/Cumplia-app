import { defineConfig } from "vitest/config";

// Los tests de integración usan scrypt real (N=2^16, ~64 MB por hash) y un Postgres
// en memoria por archivo: bajo carga en paralelo (CI) superan los 5 s por defecto.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

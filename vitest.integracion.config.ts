import { defineConfig } from "vitest/config"
import path from "path"

/**
 * Pruebas de INTEGRACIÓN contra la base real (esquema officemart). Escriben
 * datos: correr solo a propósito con `pnpm test:integracion`. No forman parte
 * de `pnpm test`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests-integracion/**/*.int.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    bail: 1,
  },
})

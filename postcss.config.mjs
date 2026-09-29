import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // `base` fijo al proyecto: sin él, @tailwindcss/postcss resuelve
    // `@import 'tailwindcss'` desde el directorio de trabajo del proceso, que
    // en `pnpm dev` (Turbopack) puede ser una carpeta padre con otro
    // package.json (p. ej. C:\Users\<usuario>) y falla con
    // "Can't resolve 'tailwindcss'".
    '@tailwindcss/postcss': { base: dirname(fileURLToPath(import.meta.url)) },
  },
}

export default config

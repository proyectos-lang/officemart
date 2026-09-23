import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Fija la raiz del proyecto: si hay otro lockfile en una carpeta padre
  // (p. ej. C:\Users\<usuario>\package-lock.json), Turbopack la tomaria como
  // raiz y no encontraria `tailwindcss` al compilar el CSS en `pnpm dev`.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  compiler: {
    // En produccion elimina console.log/info/debug/warn (ruido de depuracion
    // heredado del generador, con prefijos [v0]). Conserva console.error para
    // no perder el registro de errores reales.
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
  },
}

export default nextConfig

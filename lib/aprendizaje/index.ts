import { MODULOS } from "@/lib/constants/modulos"
import type { TutorialModulo } from "./types"
import { TUTORIAL_GENERAL } from "./contenido-general"
import { TUTORIALES_DASHBOARD } from "./contenido-dashboard"
import { TUTORIALES_VENTAS } from "./contenido-ventas"
import { TUTORIALES_COMPRAS } from "./contenido-compras"
import { TUTORIALES_INVENTARIO } from "./contenido-inventario"
import { TUTORIALES_PRODUCCION } from "./contenido-produccion"
import { TUTORIALES_FINANZAS } from "./contenido-finanzas"
import { TUTORIALES_CRM } from "./contenido-crm"
import { TUTORIALES_RRHH } from "./contenido-rrhh"
import { TUTORIALES_CONFIGURACION } from "./contenido-configuracion"

export type { TutorialModulo, OperacionPaso, PreguntaFrecuente } from "./types"
export { TUTORIAL_GENERAL }

/** Todos los tutoriales de modulos (sin el articulo general). */
export const TUTORIALES: TutorialModulo[] = [
  ...TUTORIALES_DASHBOARD,
  ...TUTORIALES_VENTAS,
  ...TUTORIALES_COMPRAS,
  ...TUTORIALES_INVENTARIO,
  ...TUTORIALES_PRODUCCION,
  ...TUTORIALES_FINANZAS,
  ...TUTORIALES_CRM,
  ...TUTORIALES_RRHH,
  ...TUTORIALES_CONFIGURACION,
]

/** Busca el tutorial de un modulo por su nombre exacto (clave de MODULOS). */
export function getTutorial(nombreModulo: string): TutorialModulo | null {
  if (nombreModulo === "general") return TUTORIAL_GENERAL
  return TUTORIALES.find((t) => t.modulo === nombreModulo) ?? null
}

/**
 * Guardrail de cobertura: modulos registrados en MODULOS que NO tienen
 * tutorial. Debe devolver [] siempre — si aparece algo, se agrego un modulo
 * sin documentarlo (ver checklist en CLAUDE.md). La pagina de Aprendizaje
 * muestra un banner a los admins cuando esta lista no esta vacia.
 */
export function modulosSinTutorial(): string[] {
  const documentados = new Set(TUTORIALES.map((t) => t.modulo))
  return MODULOS.filter((m) => !documentados.has(m.nombre)).map((m) => m.nombre)
}

// ==================== BUSQUEDA ====================

/** Normaliza para buscar: minusculas y sin tildes (quita marcas combinantes). */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

export interface ResultadoBusqueda {
  tutorial: TutorialModulo
  /** Donde matcheo: para mostrar contexto en el buscador. */
  coincidencia: string
}

/**
 * Busca un termino en titulo, descripcion, keywords, operaciones y FAQs de
 * los tutoriales dados (la pagina pasa solo los visibles para el usuario).
 * Devuelve un resultado por tutorial con la mejor coincidencia encontrada.
 */
export function buscarTemas(
  query: string,
  tutoriales: TutorialModulo[]
): ResultadoBusqueda[] {
  const q = normalizar(query.trim())
  if (q.length < 2) return []

  const resultados: ResultadoBusqueda[] = []
  for (const t of tutoriales) {
    if (normalizar(t.titulo).includes(q) || normalizar(t.modulo).includes(q)) {
      resultados.push({ tutorial: t, coincidencia: t.descripcion })
      continue
    }
    if (t.keywords.some((k) => normalizar(k).includes(q))) {
      resultados.push({ tutorial: t, coincidencia: t.descripcion })
      continue
    }
    if (normalizar(t.descripcion).includes(q)) {
      resultados.push({ tutorial: t, coincidencia: t.descripcion })
      continue
    }
    const op = t.operaciones.find(
      (o) => normalizar(o.titulo).includes(q) || o.pasos.some((p) => normalizar(p).includes(q))
    )
    if (op) {
      resultados.push({ tutorial: t, coincidencia: `Cómo: ${op.titulo}` })
      continue
    }
    const faq = t.faqs.find(
      (f) => normalizar(f.pregunta).includes(q) || normalizar(f.respuesta).includes(q)
    )
    if (faq) {
      resultados.push({ tutorial: t, coincidencia: `FAQ: ${faq.pregunta}` })
      continue
    }
    const hace = [...t.queHace, ...t.queNoHace].find((h) => normalizar(h).includes(q))
    if (hace) {
      resultados.push({ tutorial: t, coincidencia: hace })
    }
  }
  return resultados
}

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { STORAGE_PREFIX } from "@/lib/supabase/schema"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"

/**
 * Firma digital (Fase 6, script officemart-017): un PDF se sube al bucket
 * privado `documentos`, se registra con folio + hash SHA-256 y cada firmante
 * recibe un link único (/firmar/<token>). Cuando todos firman, el servidor
 * estampa las firmas y el folio en el PDF (pdf-lib) y lo guarda aparte.
 * Alcance: firma electrónica simple (Decreto 149-2013), no certificada.
 */

export const FIRMA_FEATURE_PENDING = "Firma digital pendiente: aplica scripts/officemart-017-firma-digital.sql en Supabase (tablas + bucket privado `documentos`)."
export const BUCKET_DOCUMENTOS = "documentos"

export type EstadoDocumento = "Pendiente" | "Firmado" | "Anulado" | "Vencido"
export type EntidadFirma = "cotizacion" | "orden_trabajo" | "recibo" | "estado_cuenta" | "rrhh" | "otro"
export type RolFirmante = "interno" | "externo"
export type MetodoFirma = "canvas" | "clic"

export const ETIQUETA_ENTIDAD: Record<EntidadFirma, string> = {
  cotizacion: "Cotización",
  orden_trabajo: "Orden de trabajo",
  recibo: "Recibo",
  estado_cuenta: "Estado de cuenta",
  rrhh: "RRHH",
  otro: "Documento",
}

export interface FirmanteInput {
  nombre: string
  correo?: string | null
  rol?: RolFirmante
}

export interface FirmaDocumento {
  id: number
  documento_id: number
  orden: number
  nombre: string
  correo: string | null
  rol: RolFirmante
  token: string
  metodo: MetodoFirma | null
  firmado_en: string | null
  ip: string | null
  user_agent: string | null
  firma_png_path: string | null
  nombre_firmante: string | null
  enviado_at: string | null
  visto_at: string | null
}

export interface DocumentoFirmado {
  id: number
  folio: string
  entidad: EntidadFirma
  entidad_id: number | null
  titulo: string
  hash_sha256: string
  pdf_original_path: string
  pdf_firmado_path: string | null
  hash_firmado_sha256: string | null
  estado: EstadoDocumento
  vence_en: string | null
  mensaje: string | null
  firmado_at: string | null
  anulado_at: string | null
  motivo_anulacion: string | null
  usuario: string | null
  created_at: string
  firmas: FirmaDocumento[]
}

export interface SolicitudFirma {
  entidad: EntidadFirma
  entidad_id?: number | null
  titulo: string
  pdf: Blob
  firmantes: FirmanteInput[]
  vence_dias?: number
  mensaje?: string | null
}

// ==================== PURAS ====================

/** Token aleatorio hex (por defecto 32 bytes = 64 caracteres). Navegador y Node. */
export function generarToken(bytes = 32): string {
  const arr = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("")
}

const ALFABETO_FOLIO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** Folio legible y único: FD-<empresa>-<AAAAMMDD>-<6 alfanuméricos sin ambigüedad>. */
export function generarFolio(tenantId: number, fechaISO: string, aleatorio?: string): string {
  const ymd = fechaISO.slice(0, 10).replace(/-/g, "")
  let sufijo = (aleatorio || "").toUpperCase().slice(0, 6)
  if (sufijo.length < 6) {
    const arr = new Uint8Array(6)
    globalThis.crypto.getRandomValues(arr)
    sufijo = Array.from(arr, (b) => ALFABETO_FOLIO[b % ALFABETO_FOLIO.length]).join("")
  }
  return `FD-${tenantId}-${ymd}-${sufijo}`
}

/** SHA-256 en hex de un buffer (WebCrypto: navegador y Node ≥ 18). */
export async function sha256Hex(datos: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = datos instanceof Uint8Array ? datos : new Uint8Array(datos)
  const hash = await globalThis.crypto.subtle.digest("SHA-256", buf as BufferSource)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")
}

/** Ruta en el bucket: officemart/firmas/<tenant>/<folio>-<sufijo>. */
export function rutaDocumento(tenantId: number, folio: string, sufijo: string): string {
  return `${STORAGE_PREFIX}firmas/${tenantId}/${folio}-${sufijo}`
}

export function urlFirma(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/firmar/${token}`
}

export function urlVerificacion(origin: string, folio: string): string {
  return `${origin.replace(/\/$/, "")}/verificar/${folio}`
}

export function resumenFirmas(firmas: { firmado_en: string | null }[]): { total: number; firmadas: number; pendientes: number; completo: boolean } {
  const total = firmas.length
  const firmadas = firmas.filter((f) => !!f.firmado_en).length
  return { total, firmadas, pendientes: total - firmadas, completo: total > 0 && firmadas === total }
}

export function estaVencido(doc: { estado: EstadoDocumento; vence_en: string | null }, ahoraISO: string): boolean {
  return doc.estado === "Pendiente" && !!doc.vence_en && doc.vence_en < ahoraISO
}

/** Estado a mostrar (marca Vencido aunque la fila diga Pendiente). */
export function estadoVisible(doc: { estado: EstadoDocumento; vence_en: string | null }, ahoraISO: string): EstadoDocumento {
  return estaVencido(doc, ahoraISO) ? "Vencido" : doc.estado
}

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validarFirmantes(firmantes: FirmanteInput[]): string | null {
  const validos = firmantes.filter((f) => (f.nombre || "").trim())
  if (validos.length === 0) return "Agrega al menos un firmante con nombre"
  for (const f of validos) {
    const correo = (f.correo || "").trim()
    if (correo && !RE_CORREO.test(correo)) return `Correo inválido: ${correo}`
  }
  return null
}

export function fechaMasDiasISO(iso: string, dias: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString()
}

// ==================== I/O ====================

function isMissing(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || /relation .*documentos_firm.* does not exist/.test(msg) || msg.includes("could not find the table") || (msg.includes("schema cache") && !msg.includes("relationship")) || msg.includes("bucket not found")
}

function mapFirma(r: Record<string, unknown>): FirmaDocumento {
  return {
    id: Number(r.id),
    documento_id: Number(r.documento_id),
    orden: Number(r.orden) || 1,
    nombre: String(r.nombre ?? ""),
    correo: (r.correo as string | null) ?? null,
    rol: ((r.rol as string) || "externo") as RolFirmante,
    token: String(r.token ?? ""),
    metodo: (r.metodo as MetodoFirma | null) ?? null,
    firmado_en: (r.firmado_en as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
    user_agent: (r.user_agent as string | null) ?? null,
    firma_png_path: (r.firma_png_path as string | null) ?? null,
    nombre_firmante: (r.nombre_firmante as string | null) ?? null,
    enviado_at: (r.enviado_at as string | null) ?? null,
    visto_at: (r.visto_at as string | null) ?? null,
  }
}

function mapDocumento(r: Record<string, unknown>): DocumentoFirmado {
  const firmas = Array.isArray(r.documentos_firmas) ? (r.documentos_firmas as Record<string, unknown>[]).map(mapFirma).sort((a, b) => a.orden - b.orden || a.id - b.id) : []
  return {
    id: Number(r.id),
    folio: String(r.folio ?? ""),
    entidad: ((r.entidad as string) || "otro") as EntidadFirma,
    entidad_id: r.entidad_id != null ? Number(r.entidad_id) : null,
    titulo: String(r.titulo ?? ""),
    hash_sha256: String(r.hash_sha256 ?? ""),
    pdf_original_path: String(r.pdf_original_path ?? ""),
    pdf_firmado_path: (r.pdf_firmado_path as string | null) ?? null,
    hash_firmado_sha256: (r.hash_firmado_sha256 as string | null) ?? null,
    estado: ((r.estado as string) || "Pendiente") as EstadoDocumento,
    vence_en: (r.vence_en as string | null) ?? null,
    mensaje: (r.mensaje as string | null) ?? null,
    firmado_at: (r.firmado_at as string | null) ?? null,
    anulado_at: (r.anulado_at as string | null) ?? null,
    motivo_anulacion: (r.motivo_anulacion as string | null) ?? null,
    usuario: (r.usuario as string | null) ?? null,
    created_at: String(r.created_at ?? ""),
    firmas,
  }
}

/**
 * Sube el PDF, registra el documento y crea un token por firmante.
 * Devuelve el documento con sus firmas (tokens) para construir los links.
 */
export async function solicitarFirma(input: SolicitudFirma): Promise<{ data: DocumentoFirmado | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  const tenantId = Number(stamp.razon_social_id)
  if (!(input.titulo || "").trim()) return { data: null, error: "El título es obligatorio" }
  const invalido = validarFirmantes(input.firmantes)
  if (invalido) return { data: null, error: invalido }
  if (!input.pdf || input.pdf.size === 0) return { data: null, error: "El PDF está vacío" }

  try {
    const bytes = await input.pdf.arrayBuffer()
    const hash = await sha256Hex(bytes)
    const ahora = getHondurasNowISO()
    const folio = generarFolio(tenantId, ahora)
    const path = rutaDocumento(tenantId, folio, "original.pdf")

    const up = await supabase.storage.from(BUCKET_DOCUMENTOS).upload(path, input.pdf, { contentType: "application/pdf", upsert: false })
    if (up.error) {
      if (isMissing(up.error)) return { data: null, error: FIRMA_FEATURE_PENDING }
      return { data: null, error: `No se pudo subir el PDF: ${up.error.message}` }
    }

    const vence = input.vence_dias && input.vence_dias > 0 ? fechaMasDiasISO(ahora, input.vence_dias) : null
    const ins = await supabase
      .from("documentos_firmados")
      .insert({
        razon_social_id: tenantId,
        usuario: stamp.usuario,
        folio,
        entidad: input.entidad,
        entidad_id: input.entidad_id ?? null,
        titulo: input.titulo.trim(),
        hash_sha256: hash,
        pdf_original_path: path,
        estado: "Pendiente",
        vence_en: vence,
        mensaje: (input.mensaje || "").trim() || null,
        created_at: ahora,
      })
      .select("*")
      .single()
    if (ins.error || !ins.data) {
      await supabase.storage.from(BUCKET_DOCUMENTOS).remove([path])
      if (isMissing(ins.error)) return { data: null, error: FIRMA_FEATURE_PENDING }
      return { data: null, error: ins.error?.message ?? "No se pudo registrar el documento" }
    }
    const docId = Number((ins.data as { id: number }).id)

    const firmantes = input.firmantes.filter((f) => (f.nombre || "").trim())
    const filas = firmantes.map((f, i) => ({
      razon_social_id: tenantId,
      documento_id: docId,
      orden: i + 1,
      nombre: f.nombre.trim(),
      correo: (f.correo || "").trim() || null,
      rol: f.rol || "externo",
      token: generarToken(32),
      created_at: ahora,
    }))
    const fi = await supabase.from("documentos_firmas").insert(filas).select("*")
    if (fi.error) {
      await supabase.from("documentos_firmados").delete().eq("id", docId)
      await supabase.storage.from(BUCKET_DOCUMENTOS).remove([path])
      return { data: null, error: fi.error.message }
    }
    const doc = mapDocumento({ ...(ins.data as Record<string, unknown>), documentos_firmas: fi.data })
    return { data: doc, error: null }
  } catch (err) {
    console.error("[firma] solicitar:", err)
    return { data: null, error: "Error de conexión" }
  }
}

export async function getDocumentosFirmados(
  opts: { estado?: EstadoDocumento | "Todos"; entidad?: EntidadFirma; entidadId?: number | null } = {}
): Promise<{ data: DocumentoFirmado[]; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  let q = supabase.from("documentos_firmados").select("*, documentos_firmas(*)").order("created_at", { ascending: false })
  if (opts.estado && opts.estado !== "Todos") q = q.eq("estado", opts.estado)
  if (opts.entidad) q = q.eq("entidad", opts.entidad)
  if (opts.entidadId != null) q = q.eq("entidad_id", opts.entidadId)
  const { data, error } = await q
  if (error) {
    if (isMissing(error)) return { data: [], error: FIRMA_FEATURE_PENDING, pendiente: true }
    return { data: [], error: error.message }
  }
  return { data: (data as Record<string, unknown>[]).map(mapDocumento), error: null }
}

export async function anularDocumentoFirma(id: number, motivo: string): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }
  if (!(motivo || "").trim()) return { success: false, error: "Indica el motivo" }
  const ahora = getHondurasNowISO()
  const { error } = await supabase
    .from("documentos_firmados")
    .update({ estado: "Anulado", anulado_at: ahora, motivo_anulacion: motivo.trim(), updated_at: ahora })
    .eq("id", id)
    .in("estado", ["Pendiente", "Vencido"])
  return { success: !error, error: error?.message ?? null }
}

/** URL firmada de corta vida para descargar un PDF del bucket privado. */
export async function urlDescargaDocumento(path: string, segundos = 120): Promise<{ url: string | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { url: null, error: "Cliente no disponible" }
  const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTOS).createSignedUrl(path, segundos)
  if (error) return { url: null, error: isMissing(error) ? FIRMA_FEATURE_PENDING : error.message }
  return { url: data?.signedUrl ?? null, error: null }
}

/** Envía (o reenvía) por correo el link de firma; requiere RESEND en el servidor. */
export async function enviarCorreoFirma(firmaId: number): Promise<{ enviado: boolean; motivo: string | null; url: string | null }> {
  try {
    const res = await fetch("/api/firma/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firma_id: firmaId, origin: typeof window !== "undefined" ? window.location.origin : "" }),
    })
    const json = (await res.json()) as { enviado?: boolean; motivo?: string; url?: string; error?: string }
    if (!res.ok) return { enviado: false, motivo: json.error || `Error ${res.status}`, url: json.url ?? null }
    return { enviado: !!json.enviado, motivo: json.motivo ?? null, url: json.url ?? null }
  } catch {
    return { enviado: false, motivo: "Error de conexión", url: null }
  }
}

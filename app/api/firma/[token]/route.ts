import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { estamparPdf, type FirmaEstampa } from "@/lib/server/firma-estampar"
import { BUCKET_DOCUMENTOS, rutaDocumento, urlVerificacion } from "@/lib/services/firma-digital"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"

export const runtime = "nodejs"

/**
 * Firma pública por token. SIN autenticación: el token ES la autorización.
 * Service role (bypassa RLS) y siempre filtra por el documento del token.
 * GET  → datos del documento + URL firmada del PDF (10 min).
 * POST → registra la firma; si ya firmaron todos, estampa el PDF.
 * 404 token inexistente | 410 anulado/vencido/ya firmado | 503 script pendiente.
 */

type Firma = { id: number; razon_social_id: number; documento_id: number; orden: number; nombre: string; correo: string | null; rol: string; metodo: string | null; firmado_en: string | null; firma_png_path: string | null; nombre_firmante: string | null; visto_at: string | null; ip: string | null }
type Documento = { id: number; razon_social_id: number; folio: string; titulo: string; entidad: string; estado: string; vence_en: string | null; mensaje: string | null; hash_sha256: string; pdf_original_path: string; pdf_firmado_path: string | null; firmado_at: string | null }

function esTablaAusente(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || (err.message || "").toLowerCase().includes("schema cache"))
}

async function cargar(token: string) {
  const admin = createAdminClient()
  if (!admin) return { error: NextResponse.json({ error: "Servidor no configurado" }, { status: 500 }) }
  const f = await admin.from("documentos_firmas").select("*").eq("token", token).maybeSingle()
  if (f.error) {
    if (esTablaAusente(f.error)) return { error: NextResponse.json({ error: "La firma digital no está habilitada todavía" }, { status: 503 }) }
    return { error: NextResponse.json({ error: "Error consultando el documento" }, { status: 500 }) }
  }
  if (!f.data) return { error: NextResponse.json({ error: "Este enlace no existe" }, { status: 404 }) }
  const firma = f.data as Firma
  const d = await admin.from("documentos_firmados").select("*").eq("id", firma.documento_id).maybeSingle()
  if (d.error || !d.data) return { error: NextResponse.json({ error: "Documento no encontrado" }, { status: 404 }) }
  const doc = d.data as Documento
  const ahora = getHondurasNowISO()
  if (doc.estado === "Anulado") return { error: NextResponse.json({ error: "Este documento fue anulado por el emisor" }, { status: 410 }) }
  if (doc.estado === "Pendiente" && doc.vence_en && doc.vence_en < ahora) {
    await admin.from("documentos_firmados").update({ estado: "Vencido", updated_at: ahora }).eq("id", doc.id)
    return { error: NextResponse.json({ error: "Este enlace está vencido; pide al emisor que lo reenvíe" }, { status: 410 }) }
  }
  if (doc.estado === "Vencido") return { error: NextResponse.json({ error: "Este enlace está vencido; pide al emisor que lo reenvíe" }, { status: 410 }) }
  return { admin, firma, doc, ahora }
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length < 32) return NextResponse.json({ error: "Enlace inválido" }, { status: 404 })
  const c = await cargar(token)
  if ("error" in c) return c.error
  const { admin, firma, doc, ahora } = c

  const [empresa, otras] = await Promise.all([
    admin.from("razon_social").select("nombre_empresa, nombre_comercial, logo_url").eq("id", doc.razon_social_id).maybeSingle(),
    admin.from("documentos_firmas").select("id, nombre, rol, firmado_en, orden").eq("documento_id", doc.id).order("orden"),
  ])
  if (!firma.visto_at) await admin.from("documentos_firmas").update({ visto_at: ahora }).eq("id", firma.id)

  const path = doc.estado === "Firmado" && doc.pdf_firmado_path ? doc.pdf_firmado_path : doc.pdf_original_path
  const signed = await admin.storage.from(BUCKET_DOCUMENTOS).createSignedUrl(path, 600)
  const origin = new URL(request.url).origin
  const e = empresa.data as { nombre_empresa?: string; nombre_comercial?: string; logo_url?: string | null } | null

  return NextResponse.json({
    documento: { folio: doc.folio, titulo: doc.titulo, entidad: doc.entidad, estado: doc.estado, vence_en: doc.vence_en, mensaje: doc.mensaje, hash_sha256: doc.hash_sha256, firmado_at: doc.firmado_at },
    empresa: { nombre: e?.nombre_comercial || e?.nombre_empresa || "Empresa", logo_url: e?.logo_url ?? null },
    firmante: { id: firma.id, nombre: firma.nombre, rol: firma.rol, ya_firmado: !!firma.firmado_en, firmado_en: firma.firmado_en, metodo: firma.metodo },
    otros: ((otras.data || []) as { id: number; nombre: string; rol: string; firmado_en: string | null }[]).filter((o) => o.id !== firma.id).map((o) => ({ nombre: o.nombre, rol: o.rol, firmado: !!o.firmado_en })),
    pdf_url: signed.data?.signedUrl ?? null,
    verificar_url: urlVerificacion(origin, doc.folio),
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length < 32) return NextResponse.json({ error: "Enlace inválido" }, { status: 404 })
  let body: { nombre?: string; metodo?: string; firma_png?: string; acepta?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 })
  }
  const nombre = (body.nombre || "").trim()
  const metodo = body.metodo === "canvas" ? "canvas" : "clic"
  if (!body.acepta) return NextResponse.json({ error: "Debes aceptar firmar electrónicamente" }, { status: 400 })
  if (!nombre) return NextResponse.json({ error: "Escribe tu nombre completo" }, { status: 400 })
  let png: Buffer | null = null
  if (metodo === "canvas") {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.firma_png || "")
    if (!m) return NextResponse.json({ error: "Dibuja tu firma antes de continuar" }, { status: 400 })
    png = Buffer.from(m[1], "base64")
    if (png.length < 200) return NextResponse.json({ error: "La firma está vacía" }, { status: 400 })
    if (png.length > 400_000) return NextResponse.json({ error: "La firma es demasiado grande" }, { status: 400 })
  }

  const c = await cargar(token)
  if ("error" in c) return c.error
  const { admin, firma, doc, ahora } = c
  if (firma.firmado_en) return NextResponse.json({ error: "Este documento ya fue firmado con este enlace" }, { status: 410 })
  if (doc.estado !== "Pendiente") return NextResponse.json({ error: "Este documento ya no admite firmas" }, { status: 410 })

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || null
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 300) || null

  let pngPath: string | null = null
  if (png) {
    pngPath = rutaDocumento(doc.razon_social_id, doc.folio, `firma-${firma.id}.png`)
    const up = await admin.storage.from(BUCKET_DOCUMENTOS).upload(pngPath, png, { contentType: "image/png", upsert: true })
    if (up.error) return NextResponse.json({ error: `No se pudo guardar la firma: ${up.error.message}` }, { status: 500 })
  }

  // Registro atómico "si aún no está firmada" (evita doble envío).
  const upd = await admin
    .from("documentos_firmas")
    .update({ firmado_en: ahora, metodo, ip, user_agent: userAgent, firma_png_path: pngPath, nombre_firmante: nombre })
    .eq("id", firma.id)
    .is("firmado_en", null)
    .select("id")
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 })
  if (!upd.data || upd.data.length === 0) return NextResponse.json({ error: "Este documento ya fue firmado con este enlace" }, { status: 410 })

  // ¿Firmaron todos? → estampar.
  const todas = await admin.from("documentos_firmas").select("id, nombre, rol, metodo, firmado_en, ip, firma_png_path, nombre_firmante").eq("documento_id", doc.id).order("orden")
  const lista = (todas.data || []) as { id: number; nombre: string; rol: string; metodo: string | null; firmado_en: string | null; ip: string | null; firma_png_path: string | null; nombre_firmante: string | null }[]
  const completo = lista.length > 0 && lista.every((f) => !!f.firmado_en)
  const origin = new URL(request.url).origin
  let estadoFinal = doc.estado
  let advertencia: string | null = null

  if (completo) {
    try {
      const orig = await admin.storage.from(BUCKET_DOCUMENTOS).download(doc.pdf_original_path)
      if (orig.error || !orig.data) throw new Error(orig.error?.message || "No se pudo leer el PDF original")
      const originalBytes = new Uint8Array(await orig.data.arrayBuffer())
      const empresa = await admin.from("razon_social").select("nombre_empresa, nombre_comercial").eq("id", doc.razon_social_id).maybeSingle()
      const e = empresa.data as { nombre_empresa?: string; nombre_comercial?: string } | null
      const firmas: FirmaEstampa[] = []
      for (const f of lista) {
        let pngBytes: Uint8Array | null = null
        if (f.firma_png_path) {
          const dl = await admin.storage.from(BUCKET_DOCUMENTOS).download(f.firma_png_path)
          if (dl.data) pngBytes = new Uint8Array(await dl.data.arrayBuffer())
        }
        firmas.push({ nombre: f.nombre_firmante || f.nombre, rol: f.rol, metodo: f.metodo || "clic", firmado_en: f.firmado_en || ahora, ip: f.ip, png: pngBytes })
      }
      const estampado = await estamparPdf(originalBytes, {
        folio: doc.folio,
        hash: doc.hash_sha256,
        titulo: doc.titulo,
        empresa: e?.nombre_comercial || e?.nombre_empresa || "Empresa",
        verificarUrl: urlVerificacion(origin, doc.folio),
        firmas,
      })
      const firmadoPath = rutaDocumento(doc.razon_social_id, doc.folio, "firmado.pdf")
      const upF = await admin.storage.from(BUCKET_DOCUMENTOS).upload(firmadoPath, Buffer.from(estampado), { contentType: "application/pdf", upsert: true })
      if (upF.error) throw new Error(upF.error.message)
      const hashFirmado = createHash("sha256").update(estampado).digest("hex")
      await admin.from("documentos_firmados").update({ estado: "Firmado", firmado_at: ahora, pdf_firmado_path: firmadoPath, hash_firmado_sha256: hashFirmado, updated_at: ahora }).eq("id", doc.id)
      estadoFinal = "Firmado"
    } catch (err) {
      console.error("[firma] estampar:", err)
      // La firma quedó registrada; el estampado se reintenta al abrir la bandeja.
      advertencia = "Tu firma quedó registrada, pero el PDF final aún no pudo generarse; el emisor lo recibirá en breve."
    }
  }

  return NextResponse.json({ ok: true, folio: doc.folio, documento_estado: estadoFinal, completo, verificar_url: urlVerificacion(origin, doc.folio), advertencia })
}

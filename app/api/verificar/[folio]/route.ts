import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"

/**
 * Verificación pública de un documento firmado por folio. Devuelve solo lo
 * necesario para comprobar autenticidad (estado, hashes, firmantes y fechas);
 * nunca el PDF.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ folio: string }> }) {
  const { folio } = await params
  if (!folio || !/^FD-\d+-\d{8}-[A-Z0-9]{6}$/i.test(folio)) return NextResponse.json({ error: "Folio inválido" }, { status: 404 })
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: "Servidor no configurado" }, { status: 500 })

  const d = await admin.from("documentos_firmados").select("id, razon_social_id, folio, titulo, entidad, estado, hash_sha256, hash_firmado_sha256, created_at, firmado_at, anulado_at, vence_en").eq("folio", folio.toUpperCase()).maybeSingle()
  if (d.error) {
    if (d.error.code === "42P01" || d.error.code === "PGRST205") return NextResponse.json({ error: "La verificación no está habilitada todavía" }, { status: 503 })
    return NextResponse.json({ error: "Error consultando el folio" }, { status: 500 })
  }
  if (!d.data) return NextResponse.json({ error: "No existe un documento con ese folio" }, { status: 404 })
  const doc = d.data as { id: number; razon_social_id: number; folio: string; titulo: string; entidad: string; estado: string; hash_sha256: string; hash_firmado_sha256: string | null; created_at: string; firmado_at: string | null; anulado_at: string | null; vence_en: string | null }

  const [empresa, firmas] = await Promise.all([
    admin.from("razon_social").select("nombre_empresa, nombre_comercial").eq("id", doc.razon_social_id).maybeSingle(),
    admin.from("documentos_firmas").select("nombre, nombre_firmante, rol, metodo, firmado_en, orden").eq("documento_id", doc.id).order("orden"),
  ])
  const e = empresa.data as { nombre_empresa?: string; nombre_comercial?: string } | null
  return NextResponse.json({
    folio: doc.folio,
    titulo: doc.titulo,
    entidad: doc.entidad,
    estado: doc.estado,
    empresa: e?.nombre_comercial || e?.nombre_empresa || "Empresa",
    created_at: doc.created_at,
    firmado_at: doc.firmado_at,
    anulado_at: doc.anulado_at,
    hash_sha256: doc.hash_sha256,
    hash_firmado_sha256: doc.hash_firmado_sha256,
    firmas: ((firmas.data || []) as { nombre: string; nombre_firmante: string | null; rol: string; metodo: string | null; firmado_en: string | null }[]).map((f) => ({
      nombre: f.nombre_firmante || f.nombre,
      rol: f.rol,
      metodo: f.metodo,
      firmado_en: f.firmado_en,
    })),
  })
}

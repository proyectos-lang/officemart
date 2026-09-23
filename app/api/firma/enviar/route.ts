import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { enviarCorreo, correoConfigurado, plantillaSolicitudFirma } from "@/lib/server/correo"
import { urlFirma } from "@/lib/services/firma-digital"
import { getHondurasNowISO, formatHondurasDate } from "@/lib/utils/honduras-time"

export const runtime = "nodejs"

/**
 * Envía por correo el link de firma de UN firmante. Requiere sesión (cookies):
 * el cliente de servidor aplica RLS, así que solo se alcanzan firmas del
 * tenant del usuario. Si Resend no está configurado devuelve { enviado:false }
 * con la URL para compartirla por otro medio.
 */
export async function POST(request: Request) {
  let body: { firma_id?: number; origin?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 })
  }
  const firmaId = Number(body.firma_id)
  if (!firmaId) return NextResponse.json({ error: "firma_id requerido" }, { status: 400 })

  const supabase = await createClient()
  if (!supabase) return NextResponse.json({ error: "Servidor no configurado" }, { status: 500 })
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 })

  const f = await supabase.from("documentos_firmas").select("id, nombre, correo, token, documento_id").eq("id", firmaId).maybeSingle()
  if (f.error || !f.data) return NextResponse.json({ error: "Firmante no encontrado" }, { status: 404 })
  const firma = f.data as { id: number; nombre: string; correo: string | null; token: string; documento_id: number }
  const d = await supabase.from("documentos_firmados").select("titulo, estado, vence_en, mensaje, razon_social_id").eq("id", firma.documento_id).maybeSingle()
  if (d.error || !d.data) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
  const doc = d.data as { titulo: string; estado: string; vence_en: string | null; mensaje: string | null; razon_social_id: number }
  if (doc.estado !== "Pendiente") return NextResponse.json({ error: "El documento ya no está pendiente de firma" }, { status: 409 })

  const origin = (body.origin || "").replace(/\/$/, "") || new URL(request.url).origin
  const url = urlFirma(origin, firma.token)
  if (!firma.correo) return NextResponse.json({ enviado: false, motivo: "El firmante no tiene correo; comparte el enlace manualmente.", url })
  if (!correoConfigurado()) return NextResponse.json({ enviado: false, motivo: "Correo no configurado en el servidor (RESEND_API_KEY / RESEND_FROM); comparte el enlace manualmente.", url })

  const empresa = await supabase.from("razon_social").select("nombre_empresa, nombre_comercial").eq("id", doc.razon_social_id).maybeSingle()
  const e = empresa.data as { nombre_empresa?: string; nombre_comercial?: string } | null
  const plantilla = plantillaSolicitudFirma({
    empresa: e?.nombre_comercial || e?.nombre_empresa || "Tu proveedor",
    firmante: firma.nombre,
    titulo: doc.titulo,
    url,
    venceEn: doc.vence_en ? formatHondurasDate(doc.vence_en) : null,
    mensaje: doc.mensaje,
  })
  const res = await enviarCorreo({ to: firma.correo, subject: plantilla.subject, html: plantilla.html, text: plantilla.text, replyTo: auth.user.email ?? undefined })
  if (!res.ok) return NextResponse.json({ enviado: false, motivo: res.error ?? "No se pudo enviar", url })
  await supabase.from("documentos_firmas").update({ enviado_at: getHondurasNowISO() }).eq("id", firma.id)
  return NextResponse.json({ enviado: true, url })
}

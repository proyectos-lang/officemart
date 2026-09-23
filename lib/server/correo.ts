/**
 * Envío de correo transaccional vía Resend (API REST, sin SDK).
 * SOLO servidor (route handlers / server actions). Variables:
 *   RESEND_API_KEY  — clave de https://resend.com
 *   RESEND_FROM     — remitente verificado, p.ej. "EasyCount <no-reply@tudominio.com>"
 * Si faltan, `enviarCorreo` devuelve { ok: false, configurado: false } y la
 * app ofrece copiar el link para mandarlo por WhatsApp u otro medio.
 */

export function correoConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM)
}

export interface CorreoInput {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
}

export async function enviarCorreo(input: CorreoInput): Promise<{ ok: boolean; configurado: boolean; id?: string; error?: string }> {
  if (!correoConfigurado()) return { ok: false, configurado: false, error: "Correo no configurado (RESEND_API_KEY / RESEND_FROM)" }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
      }),
    })
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }
    if (!res.ok) return { ok: false, configurado: true, error: json.message || json.name || `Resend respondió ${res.status}` }
    return { ok: true, configurado: true, id: json.id }
  } catch (err) {
    console.error("[correo] enviar:", err)
    return { ok: false, configurado: true, error: "No se pudo contactar al servicio de correo" }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)
}

/** Plantilla del correo de solicitud de firma. */
export function plantillaSolicitudFirma(p: { empresa: string; firmante: string; titulo: string; url: string; venceEn?: string | null; mensaje?: string | null }): { subject: string; html: string; text: string } {
  const subject = `${p.empresa}: documento para firmar — ${p.titulo}`
  const vence = p.venceEn ? `<p style="color:#78716c;font-size:13px">Este enlace vence el ${escapeHtml(p.venceEn)}.</p>` : ""
  const mensaje = p.mensaje ? `<blockquote style="border-left:3px solid #e7e5e4;margin:12px 0;padding:6px 12px;color:#44403c">${escapeHtml(p.mensaje)}</blockquote>` : ""
  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1917">
    <h2 style="font-weight:600">${escapeHtml(p.empresa)}</h2>
    <p>Hola ${escapeHtml(p.firmante)},</p>
    <p>${escapeHtml(p.empresa)} te envió el documento <strong>${escapeHtml(p.titulo)}</strong> para su firma electrónica.</p>
    ${mensaje}
    <p style="margin:24px 0"><a href="${p.url}" style="background:#1c1917;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Revisar y firmar</a></p>
    <p style="color:#78716c;font-size:13px">Si el botón no funciona, copia este enlace en tu navegador:<br>${p.url}</p>
    ${vence}
    <p style="color:#a8a29e;font-size:12px;margin-top:32px">Firma electrónica simple (Decreto 149-2013, Honduras). Enviado por EasyCount.</p>
  </div>`
  const text = `${p.empresa} te envió el documento "${p.titulo}" para firmar. Ábrelo aquí: ${p.url}${p.venceEn ? ` (vence el ${p.venceEn})` : ""}`
  return { subject, html, text }
}

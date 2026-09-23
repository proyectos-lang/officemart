import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { STORAGE_PREFIX } from '@/lib/supabase/schema'

/**
 * Descarga una imagen desde una URL externa (server-side, sin CORS) y la sube al
 * bucket `productos` de Supabase Storage, devolviendo su URL pública. Se usa
 * cuando el usuario elige una imagen de la web (buscador o URL pegada) y quiere
 * conservarla en su propio almacenamiento (a prueba de que el origen la borre).
 *
 * Mismo patrón de seguridad que /api/upload-imagen: exige usuario autenticado y
 * usa la service role para subir (salta RLS). Valida tipo y tamaño.
 */

export const runtime = 'nodejs'
export const maxDuration = 30

const MIME_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const EXT_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
}
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB (imágenes de la web pueden pesar más)

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 })
  }

  const authClient = await createServerClient()
  if (!authClient) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 })
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let urlExterna = ''
  try {
    const body = await req.json()
    urlExterna = String(body?.url || '').trim()
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 })
  }
  if (!/^https?:\/\/.+/i.test(urlExterna)) {
    return NextResponse.json({ error: 'URL de imagen inválida' }, { status: 400 })
  }

  try {
    // Descarga la imagen (con un User-Agent para no ser rechazada por algunos hosts).
    const resp = await fetch(urlExterna, {
      headers: { 'User-Agent': 'Mozilla/5.0 EasyCount', 'Accept': 'image/*' },
      redirect: 'follow',
    })
    if (!resp.ok) {
      return NextResponse.json({ error: `El origen respondió ${resp.status}. Prueba con otra imagen.` }, { status: 400 })
    }
    const contentType = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!MIME_PERMITIDOS.has(contentType)) {
      return NextResponse.json({ error: 'Esa dirección no es una imagen válida (JPG, PNG, WEBP o GIF).' }, { status: 400 })
    }
    const arrayBuffer = await resp.arrayBuffer()
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'La imagen está vacía.' }, { status: 400 })
    }
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'La imagen supera el límite de 8 MB.' }, { status: 400 })
    }

    const ext = EXT_POR_MIME[contentType] || 'jpg'
    const fileName = `${STORAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
    const { error: uploadError } = await supabase.storage
      .from('productos')
      .upload(fileName, Buffer.from(arrayBuffer), { contentType, upsert: true })
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 400 })

    const { data } = supabase.storage.from('productos').getPublicUrl(fileName)
    return NextResponse.json({ url: data.publicUrl })
  } catch (err) {
    console.error('[importar-imagen-url] excepción:', err)
    return NextResponse.json({ error: 'No se pudo importar la imagen (¿URL accesible?).' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { STORAGE_PREFIX } from '@/lib/supabase/schema'

// Solo imagenes; el bucket "productos" guarda fotos de productos y logos.
const MIME_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const EXT_PERMITIDAS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  // Prefer service role key (bypasses RLS); fall back to anon key
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: 'Supabase no configurado' },
      { status: 500 }
    )
  }

  // Solo usuarios autenticados pueden subir. La subida usa la service role
  // (salta RLS); sin este chequeo cualquiera con la URL podria escribir al
  // bucket con archivos arbitrarios.
  const authClient = await createServerClient()
  if (!authClient) {
    return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 })
  }
  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No se recibio ningun archivo' }, { status: 400 })
    }

    // Validacion de tamano.
    if (file.size === 0) {
      return NextResponse.json({ error: 'El archivo esta vacio' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'La imagen supera el limite de 5 MB' },
        { status: 400 }
      )
    }

    // Validacion de tipo (MIME + extension).
    const fileExt = (file.name.split('.').pop() || '').toLowerCase()
    if (!MIME_PERMITIDOS.has(file.type) || !EXT_PERMITIDAS.has(fileExt)) {
      return NextResponse.json(
        { error: 'Solo se aceptan imagenes JPG, PNG, WEBP o GIF' },
        { status: 400 }
      )
    }

    const fileName = `${STORAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error: uploadError } = await supabase.storage
      .from('productos')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 400 })
    }

    const { data } = supabase.storage.from('productos').getPublicUrl(fileName)

    return NextResponse.json({ url: data.publicUrl })
  } catch (err) {
    console.error('[API] Error subiendo imagen:', err)
    return NextResponse.json({ error: 'Error interno al subir imagen' }, { status: 500 })
  }
}

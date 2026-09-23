import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { emitirCorrelativo, SERIES } from "@/lib/services/correlativos"

export const runtime = "nodejs"

/**
 * Recibe el carrito del cliente (SIN autenticacion; el token es la
 * autorizacion). Crea el pedido en estado Pendiente y VENCE el link
 * (estado 'Usado').
 *
 * Seguridad:
 *  - Los PRECIOS se recalculan desde la BD (precio_venta_sugerido); lo que
 *    venga en el body jamas se usa para valorar.
 *  - Los productos deben pertenecer al tenant del link (y al link si es
 *    tipo 'seleccion').
 *  - Las cantidades se validan contra el stock actual.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Link inválido" }, { status: 404 })
  }

  let body: {
    cliente_nombre?: string
    cliente_telefono?: string
    notas?: string
    lineas?: { producto_id?: number; cantidad?: number }[]
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }

  const clienteNombre = (body.cliente_nombre || "").trim()
  if (!clienteNombre) {
    return NextResponse.json({ error: "Escribe tu nombre para enviar el pedido" }, { status: 400 })
  }
  const lineasInput = (body.lineas || []).filter(
    (l) => Number(l.producto_id) > 0 && Number(l.cantidad) > 0
  )
  if (lineasInput.length === 0) {
    return NextResponse.json({ error: "El carrito está vacío" }, { status: 400 })
  }
  if (lineasInput.length > 200) {
    return NextResponse.json({ error: "Demasiadas líneas en el carrito" }, { status: 400 })
  }

  const supabase = createAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Servidor no configurado" }, { status: 500 })
  }

  // 1) Revalidar el link.
  const { data: link, error: linkErr } = await supabase
    .from("catalogo_links")
    .select("id, razon_social_id, tipo, estado, fecha_expiracion")
    .eq("token", token)
    .maybeSingle()
  if (linkErr) {
    if (linkErr.code === "42P01" || linkErr.code === "PGRST205") {
      return NextResponse.json(
        { error: "El catálogo en línea no está habilitado todavía" },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Error consultando el link" }, { status: 500 })
  }
  if (!link) return NextResponse.json({ error: "Este link no existe" }, { status: 404 })
  if (link.estado !== "Activo") {
    return NextResponse.json({ error: "Este link ya fue utilizado o está vencido" }, { status: 410 })
  }
  if (link.fecha_expiracion && new Date(link.fecha_expiracion) < new Date()) {
    await supabase.from("catalogo_links").update({ estado: "Vencido" }).eq("id", link.id)
    return NextResponse.json({ error: "Este link está vencido" }, { status: 410 })
  }

  // 2) Si es seleccion, los productos deben pertenecer al link.
  if (link.tipo === "seleccion") {
    const { data: sel } = await supabase
      .from("catalogo_link_productos")
      .select("producto_id")
      .eq("link_id", link.id)
    const permitidos = new Set((sel || []).map((s) => s.producto_id))
    const fuera = lineasInput.find((l) => !permitidos.has(Number(l.producto_id)))
    if (fuera) {
      return NextResponse.json({ error: "Hay productos que no pertenecen a este catálogo" }, { status: 400 })
    }
  }

  // 3) Precios y stock desde la BD (fuente de verdad).
  const ids = lineasInput.map((l) => Number(l.producto_id))
  const { data: productos, error: prodErr } = await supabase
    .from("productos")
    .select("id, nombre, precio_venta_sugerido, stock_total")
    .eq("razon_social_id", link.razon_social_id)
    .in("id", ids)
  if (prodErr) return NextResponse.json({ error: "Error consultando productos" }, { status: 500 })

  const porId = new Map((productos || []).map((p) => [p.id, p]))
  const lineas: { producto_id: number; cantidad: number; precio_unitario: number; subtotal: number }[] = []
  for (const l of lineasInput) {
    const p = porId.get(Number(l.producto_id))
    if (!p) {
      return NextResponse.json({ error: "Un producto del carrito no existe en este catálogo" }, { status: 400 })
    }
    const cantidad = Number(l.cantidad)
    if (cantidad > Number(p.stock_total || 0)) {
      return NextResponse.json(
        { error: `Sin disponibilidad suficiente de "${p.nombre}". Ajusta la cantidad.` },
        { status: 400 }
      )
    }
    const precio = Number(p.precio_venta_sugerido || 0)
    lineas.push({
      producto_id: p.id,
      cantidad,
      precio_unitario: precio,
      subtotal: +(cantidad * precio).toFixed(2),
    })
  }
  const total = +lineas.reduce((a, l) => a + l.subtotal, 0).toFixed(2)

  // 4) Correlativo PED-#### del tenant: atómico (RPC officemart-001, con el
  //    tenant del LINK porque aquí no hay sesión). Sin el script, COUNT+1.
  let numeroPedido: string
  const emitido = await emitirCorrelativo(supabase, SERIES.PEDIDO, "PED-", 4, {
    razonSocialId: link.razon_social_id,
  })
  if (emitido.numero) {
    numeroPedido = emitido.numero
  } else {
    const { count } = await supabase
      .from("pedidos_encabezado")
      .select("*", { count: "exact", head: true })
      .eq("razon_social_id", link.razon_social_id)
    numeroPedido = `PED-${((count || 0) + 1).toString().padStart(4, "0")}`
  }

  // 5) Insertar pedido + detalle (tenant del LINK, no del request).
  const { data: pedido, error: pedErr } = await supabase
    .from("pedidos_encabezado")
    .insert({
      razon_social_id: link.razon_social_id,
      link_id: link.id,
      numero_pedido: numeroPedido,
      cliente_nombre: clienteNombre.slice(0, 120),
      cliente_telefono: (body.cliente_telefono || "").trim().slice(0, 40) || null,
      notas: (body.notas || "").trim().slice(0, 500) || null,
      total,
    })
    .select("id")
    .single()
  if (pedErr) return NextResponse.json({ error: "No se pudo registrar el pedido" }, { status: 500 })

  const { error: detErr } = await supabase.from("pedidos_detalle").insert(
    lineas.map((l) => ({ ...l, razon_social_id: link.razon_social_id, pedido_id: pedido.id }))
  )
  if (detErr) {
    await supabase.from("pedidos_encabezado").delete().eq("id", pedido.id)
    return NextResponse.json({ error: "No se pudo registrar el detalle del pedido" }, { status: 500 })
  }

  // 6) El link muere al enviarse el carrito.
  await supabase.from("catalogo_links").update({ estado: "Usado" }).eq("id", link.id)

  return NextResponse.json({ numero_pedido: numeroPedido, total })
}

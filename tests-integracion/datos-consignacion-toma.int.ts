/**
 * Datos de demostración para CONSIGNACIÓN y TOMA FÍSICA (Office Mart), con las
 * funciones de la app. Reanudable: cada paso comprueba si ya existe.
 *
 *   pnpm test:integracion datos-consignacion-toma
 *
 * Consignación: dos localizaciones de mercancía de proveedores (TecnoImport y
 * Muebles y Oficinas), entrada de mercancía, ventas de agosto y septiembre y
 * liquidación al proveedor de lo vendido en agosto (septiembre queda pendiente).
 * Toma física: "Bodega San Pedro Sula" con una toma cerrada y ajustada, y
 * "Sala de exhibición Tegucigalpa" con una toma ABIERTA a medio contar (ese
 * almacén queda congelado hasta cerrarla o cancelarla).
 */
import { describe, it, expect, beforeAll, vi } from "vitest"

vi.mock("@/lib/supabase/client", async () => {
  const mod = await import("./cliente")
  return { createClient: () => mod.getCliente(), isSupabaseConfigured: () => true }
})

import { getCliente, iniciarSesion } from "./cliente"
import { saveAlmacen, saveLocalizacion, saveProducto, getAlmacenes, getLocalizaciones } from "@/lib/services/catalogos"
import { procesarIngresoManual, procesarTraslado } from "@/lib/services/inventario"
import { setLocalizacionConsignacion, getConsignacionPendiente, liquidarConsignacion } from "@/lib/services/consignacion"
import { crearVenta } from "@/lib/services/ventas"
import { abrirToma, getTomaDetalle, registrarConteo, cerrarToma, getTomas } from "@/lib/services/toma-fisica"

const r2 = (n: number) => +(Number(n) || 0).toFixed(2)
const ts = (fecha: string, h: number, m = 0) => `${fecha}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`
function ok(res: { error: string | null }, que: string): void {
  if (res.error) throw new Error(`${que}: ${res.error}`)
}

async function idPorNombre(tabla: string, nombre: string): Promise<number | null> {
  const { data } = await getCliente().from(tabla).select("id").eq("nombre", nombre).limit(1)
  return ((data || []) as { id: number }[])[0]?.id ?? null
}

const CONSIGNADOS = [
  { prov: "TecnoImport Centroamérica", loc: "Consignación TecnoImport", nombre: "Impresora multifuncional Epson L3250", codigo: "CON-001", cat: "Tecnología", costo: 4200, precio: 5900, cant: 12 },
  { prov: "TecnoImport Centroamérica", loc: "Consignación TecnoImport", nombre: "Proyector Epson PowerLite X49", codigo: "CON-002", cat: "Tecnología", costo: 11500, precio: 15900, cant: 5 },
  { prov: "TecnoImport Centroamérica", loc: "Consignación TecnoImport", nombre: "Laptop Lenovo IdeaPad 3 15 pulgadas", codigo: "CON-003", cat: "Tecnología", costo: 13800, precio: 18900, cant: 6 },
  { prov: "Muebles y Oficinas S.A.", loc: "Consignación Muebles y Oficinas", nombre: "Pizarra acrílica 120 x 90 cm", codigo: "CON-004", cat: "Mobiliario de oficina", costo: 1450, precio: 2300, cant: 15 },
  { prov: "Muebles y Oficinas S.A.", loc: "Consignación Muebles y Oficinas", nombre: "Mesa de reuniones para 8 personas", codigo: "CON-005", cat: "Mobiliario de oficina", costo: 9800, precio: 14500, cant: 3 },
]

// Ventas desde las localizaciones de consignación: [fecha, código, cantidad, cliente]
const VENTAS_CONSIG: [string, string, number, string][] = [
  ["2026-08-05", "CON-001", 2, "Despacho Contable Rivera & Asociados"],
  ["2026-08-12", "CON-002", 1, "Universidad Tecnológica del Norte"],
  ["2026-08-19", "CON-003", 2, "Banco Comunal Esperanza"],
  ["2026-08-26", "CON-004", 4, "Colegio Bilingüe Los Pinares"],
  ["2026-09-03", "CON-001", 3, "Clínica Médica Santa Fe"],
  ["2026-09-10", "CON-003", 1, "Constructora Honducasa"],
  ["2026-09-16", "CON-005", 1, "Hotel Plaza Copán"],
  ["2026-09-24", "CON-002", 1, "Instituto Técnico Honduras"],
  ["2026-09-26", "CON-004", 3, "Farmacia La Económica"],
]

describe("Datos de demo: consignación y toma física", () => {
  let almPrincipal = 0
  let locPrincipal = 0
  const prodId: Record<string, number> = {}

  beforeAll(async () => {
    await iniciarSesion()
    const alm = await getAlmacenes()
    almPrincipal = alm.data.find((a) => a.nombre === "Principal")!.id!
    const locs = await getLocalizaciones(almPrincipal)
    locPrincipal = locs.data.find((l) => l.nombre === "General")?.id ?? locs.data[0].id!
  })

  it("1. Localizaciones de consignación y productos consignados", async () => {
    const { data: cats } = await getCliente().from("categorias").select("id, nombre")
    const catId = (n: string) => ((cats || []) as { id: number; nombre: string }[]).find((c) => c.nombre === n)?.id ?? null
    for (const nombreLoc of ["Consignación TecnoImport", "Consignación Muebles y Oficinas"]) {
      let locId = await idPorNombre("localizaciones", nombreLoc)
      if (!locId) {
        const r = await saveLocalizacion({ almacen_id: almPrincipal, nombre: nombreLoc }, true)
        ok(r, `localización ${nombreLoc}`)
        locId = r.data!.id!
      }
      const prov = CONSIGNADOS.find((c) => c.loc === nombreLoc)!.prov
      const provId = await idPorNombre("proveedores", prov)
      expect(provId).toBeTruthy()
      ok(await setLocalizacionConsignacion(locId, { consignacion: true, propietario_proveedor_id: provId }), "marcar consignación")
    }
    for (const c of CONSIGNADOS) {
      const { data: ex } = await getCliente().from("productos").select("id").eq("codigo_barras", c.codigo).maybeSingle()
      if (ex) { prodId[c.codigo] = (ex as { id: number }).id; continue }
      const r = await saveProducto({ nombre: c.nombre, codigo_barras: c.codigo, precio_venta_sugerido: c.precio, categoria_id: catId(c.cat) }, true)
      ok(r, `producto ${c.nombre}`)
      prodId[c.codigo] = r.data!.id!
    }
  })

  it("2. Entrada de la mercancía consignada (1 de agosto)", async () => {
    for (const c of CONSIGNADOS) {
      const locId = (await idPorNombre("localizaciones", c.loc))!
      const { data: prev } = await getCliente().from("transacciones_inventario").select("id").eq("producto_id", prodId[c.codigo]).eq("localizacion_id", locId).gt("cantidad", 0).limit(1)
      if ((prev || []).length > 0) continue
      ok(await procesarIngresoManual({
        tipo: "ingreso", producto_id: prodId[c.codigo], almacen_id: almPrincipal, localizacion_id: locId, cantidad: c.cant, costo_unitario: c.costo,
        observaciones: `Recepción en consignación de ${c.prov} (costo pactado L ${c.costo})`, stock_anterior: 0, costo_anterior: 0, nuevo_stock: c.cant, nuevo_costo: c.costo,
      }), `ingreso ${c.codigo}`)
      await getCliente().from("transacciones_inventario").update({ fecha: ts("2026-08-01", 9) }).eq("producto_id", prodId[c.codigo]).eq("localizacion_id", locId).gt("cantidad", 0)
    }
  })

  it("3. Ventas desde consignación (agosto y septiembre)", async () => {
    const { data: cuentas } = await getCliente().from("cuentas_config").select("id, nombre")
    const cuentaId = ((cuentas || []) as { id: number; nombre: string }[]).find((c) => c.nombre.startsWith("Banco Atlántida · "))!.id
    for (const [fecha, cod, cant, cliente] of VENTAS_CONSIG) {
      const c = CONSIGNADOS.find((x) => x.codigo === cod)!
      const locId = (await idPorNombre("localizaciones", c.loc))!
      const { data: ya } = await getCliente().from("transacciones_inventario").select("id").eq("producto_id", prodId[cod]).eq("localizacion_id", locId).eq("tipo_movimiento", "Salida Venta").gte("fecha", `${fecha}T00:00:00`).lte("fecha", `${fecha}T23:59:59`).limit(1)
      if ((ya || []).length > 0) continue
      const { data: cli } = await getCliente().from("clientes").select("id, vendedor_id").eq("nombre", cliente).single()
      const cl = cli as { id: number; vendedor_id: number | null }
      const subtotal = r2(cant * c.precio)
      const isv = r2(subtotal * 0.15)
      const total = r2(subtotal + isv)
      const credito = fecha >= "2026-09-20"
      const v = await crearVenta({
        encabezado: { numero_factura: "", cliente_id: cl.id, almacen_id: almPrincipal, aplica_impuesto: true, porcentaje_impuesto: 15, descuento: 0, subtotal, impuesto_total: isv, total_venta: total, estado_pago: credito ? "Pendiente" : "Pagado", valorpago: credito ? 0 : total, vendedor_id: cl.vendedor_id, fecha_venta: ts(fecha, 11, 15) },
        detalles: [{ producto_id: prodId[cod], cantidad: cant, precio_unitario: c.precio, costo_promedio_momento: c.costo, utilidad_linea: r2((c.precio - c.costo) * cant) }],
        almacen_id: almPrincipal,
        localizacion_id: locId,
        pagos_detalle: credito ? [] : [{ metodo_pago: "Banco", cuenta_id: cuentaId, monto_bruto: total, porcentaje_comision: 0 }],
      })
      ok(v, `venta consignada ${fecha} ${cod}`)
      await getCliente().from("transacciones_inventario").update({ fecha: ts(fecha, 11, 15) }).eq("referencia_id", v.data!.id!).eq("tipo_movimiento", "Salida Venta")
    }
  })

  it("4. Liquidación al proveedor de lo vendido en agosto", async () => {
    const { count } = await getCliente().from("consignacion_liquidaciones").select("id", { count: "exact", head: true }).neq("estado", "Anulada")
    if ((count || 0) > 0) return
    const pend = await getConsignacionPendiente()
    ok(pend, "pendiente de consignación")
    const tecno = pend.data.find((g) => g.proveedor_nombre.startsWith("TecnoImport"))
    expect(tecno).toBeTruthy()
    const agosto = tecno!.items.filter((i) => i.fecha.slice(0, 10) < "2026-09-01")
    expect(agosto.length).toBeGreaterThan(0)
    ok(await liquidarConsignacion({ proveedor_id: tecno!.proveedor_id, localizacion_id: tecno!.localizacion_id, items: agosto, dias_credito: 30, notas: "Liquidación de ventas consignadas de agosto 2026" }), "liquidar")
    const despues = await getConsignacionPendiente()
    const total = despues.data.reduce((a, g) => a + g.total, 0)
    expect(total).toBeGreaterThan(0)
  })

  it("5. Almacenes de la toma física con stock trasladado desde Principal", async () => {
    const destinos = [
      { almacen: "Bodega San Pedro Sula", ubicacion: "Col. Trejo, San Pedro Sula", locs: ["Estantería A", "Estantería B"] },
      { almacen: "Sala de exhibición Tegucigalpa", ubicacion: "Blvd. Morazán, Tegucigalpa", locs: ["Piso de venta"] },
    ]
    const traslados: Record<string, [string, number, number][]> = {
      // [código, cantidad, índice de localización]
      "Bodega San Pedro Sula": [["PAP-001", 60, 0], ["PAP-002", 30, 0], ["PAP-003", 40, 0], ["PAP-006", 80, 1], ["PAP-007", 20, 1], ["LIM-001", 30, 1], ["LIM-002", 15, 1], ["TEC-004", 20, 0]],
      "Sala de exhibición Tegucigalpa": [["TEC-002", 10, 0], ["TEC-003", 8, 0], ["TEC-004", 12, 0], ["PAP-003", 15, 0], ["PAP-006", 25, 0], ["LIM-003", 10, 0]],
    }
    for (const d of destinos) {
      let almId = await idPorNombre("almacenes", d.almacen)
      if (!almId) {
        const r = await saveAlmacen({ nombre: d.almacen, ubicacion: d.ubicacion }, true)
        ok(r, `almacén ${d.almacen}`)
        almId = r.data!.id!
      }
      const locIds: number[] = []
      for (const ln of d.locs) {
        const { data: l } = await getCliente().from("localizaciones").select("id").eq("almacen_id", almId).eq("nombre", ln).limit(1)
        let id = ((l || []) as { id: number }[])[0]?.id
        if (!id) {
          const r = await saveLocalizacion({ almacen_id: almId, nombre: ln }, true)
          ok(r, `localización ${ln}`)
          id = r.data!.id!
        }
        locIds.push(id)
      }
      const { count } = await getCliente().from("transacciones_inventario").select("id", { count: "exact", head: true }).eq("almacen_id", almId).eq("tipo_movimiento", "Traslado Entrada")
      if ((count || 0) > 0) continue
      for (const [cod, cant, li] of traslados[d.almacen]) {
        const { data: p } = await getCliente().from("productos").select("id, costo_promedio").eq("codigo_barras", cod).single()
        const prod = p as { id: number; costo_promedio: number }
        ok(await procesarTraslado({ producto_id: prod.id, origen_almacen_id: almPrincipal, origen_localizacion_id: locPrincipal, destino_almacen_id: almId, destino_localizacion_id: locIds[li], cantidad: cant, costo_unitario: Number(prod.costo_promedio) }), `traslado ${cod} a ${d.almacen}`)
      }
    }
  })

  it("6. Toma física CERRADA en Bodega San Pedro Sula (con diferencias ajustadas)", async () => {
    const almId = (await idPorNombre("almacenes", "Bodega San Pedro Sula"))!
    const tomas = await getTomas()
    if (tomas.data.some((t) => t.almacen_id === almId)) return
    const t = await abrirToma(almId, "Conteo trimestral de bodega")
    ok(t, "abrir toma SPS")
    const det = await getTomaDetalle(t.data!.id)
    ok(det, "detalle")
    // Diferencias: faltan 3 resmas carta y 1 USB; sobran 2 libras de café; el resto cuadra.
    const ajuste: Record<string, number> = { "PAP-001": -3, "TEC-004": -1, "LIM-001": 2 }
    const { data: prods } = await getCliente().from("productos").select("id, codigo_barras")
    const cod = new Map(((prods || []) as { id: number; codigo_barras: string }[]).map((p) => [p.id, p.codigo_barras]))
    ok(await registrarConteo(det.data.map((d) => ({ detalle_id: d.id, conteo: Number(d.stock_sistema) + (ajuste[cod.get(d.producto_id) || ""] || 0), contado_por: "Rosa Elvira Murillo" }))), "conteos SPS")
    const c = await cerrarToma(t.data!.id, { ajustarNoContadas: false })
    ok(c, "cerrar toma SPS")
    expect(c.data!.ajustadas).toBe(3)
  })

  it("7. Toma física ABIERTA en la Sala de exhibición (a medio contar)", async () => {
    const almId = (await idPorNombre("almacenes", "Sala de exhibición Tegucigalpa"))!
    const tomas = await getTomas()
    if (tomas.data.some((t) => t.almacen_id === almId)) return
    const t = await abrirToma(almId, "Conteo de cierre de mes — sala de exhibición")
    ok(t, "abrir toma sala")
    const det = await getTomaDetalle(t.data!.id)
    // Se cuentan las primeras tres líneas; una con faltante de 2 mouse.
    const { data: prods } = await getCliente().from("productos").select("id, codigo_barras")
    const cod = new Map(((prods || []) as { id: number; codigo_barras: string }[]).map((p) => [p.id, p.codigo_barras]))
    const primeras = det.data.slice(0, 3)
    ok(await registrarConteo(primeras.map((d) => ({ detalle_id: d.id, conteo: Number(d.stock_sistema) + (cod.get(d.producto_id) === "TEC-002" ? -2 : 0), contado_por: "Sofía Alejandra Pineda" }))), "conteos sala")
    const tomasDespues = await getTomas()
    expect(tomasDespues.data.find((x) => x.id === t.data!.id)?.estado).toBe("Abierta")
  })
})

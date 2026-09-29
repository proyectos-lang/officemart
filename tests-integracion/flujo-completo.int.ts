/**
 * VALIDACIÓN DE PUNTA A PUNTA contra la base real (empresa del usuario de
 * validación). Ejecuta, paso por paso, las MISMAS funciones de servicio que
 * usan las pantallas, verifica el efecto en la base y deja los datos creados
 * para revisarlos a mano. Informe: docs/VALIDACION-FLUJO-COMPLETO.md
 *
 *   pnpm test:integracion
 *
 * Todo lo creado lleva el prefijo "VAL" para reconocerlo. Si ya existe el
 * producto VAL-CUAD-001 la prueba se detiene (no duplica datos).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { writeFileSync } from "node:fs"
import { PDFDocument, StandardFonts } from "pdf-lib"

vi.mock("@/lib/supabase/client", async () => {
  const mod = await import("./cliente")
  return {
    createClient: () => mod.getCliente(),
    isSupabaseConfigured: () => true,
  }
})

import { getCliente, iniciarSesion } from "./cliente"
import { getAlmacenes, getLocalizaciones, createCategoria, saveProducto, saveCliente, saveProveedor, type Producto } from "@/lib/services/catalogos"
import { createCompraMaterial, recibirCompraMaterial } from "@/lib/services/produccion-compras"
import { upsertReceta } from "@/lib/services/produccion-recetas"
import { setProductoFabricado } from "@/lib/services/productos-fabricados"
import { createOrden, setEstadoOrden } from "@/lib/services/produccion-ordenes"
import { createCorrida, ejecutarCorrida } from "@/lib/services/produccion-corridas"
import { recibirCorrida } from "@/lib/services/produccion-recepcion"
import { saveCuenta, getCuentas, registrarMovimientoCuenta } from "@/lib/services/cuentas"
import { getSesionAbierta, abrirSesion, getSaldoActualSesionAbierta } from "@/lib/services/caja-chica"
import { crearVenta, getVentas } from "@/lib/services/ventas"
import { getConceptosGasto, createConceptoGasto, createGasto, getCuentasPorPagar, type CategoriaMacro } from "@/lib/services/gastos"
import { getEstadoResultadosMensual } from "@/lib/services/estado-resultados"
import { saveEmpleado, getSaldosVacaciones, registrarVacaciones, subirDocumentoEmpleado, getDocumentosEmpleado, urlDocumentoEmpleado, saveNovedad, type Empleado } from "@/lib/services/rrhh"
import { generarNomina, getNominaCompleta, aprobarNomina, pagarNomina } from "@/lib/services/nomina"
import { getBalanceOperativo } from "@/lib/services/balance"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"

const r2 = (n: number) => +(Number(n) || 0).toFixed(2)
const HOY = getHondurasTodayISODate()
const ANIO = Number(HOY.slice(0, 4))
const MES = Number(HOY.slice(5, 7))
const INICIO_MES = `${HOY.slice(0, 7)}-01`
const FIN_MES = (() => {
  const d = new Date(Date.UTC(ANIO, MES, 0))
  return `${HOY.slice(0, 7)}-${String(d.getUTCDate()).padStart(2, "0")}`
})()

/** Estado compartido entre pasos (cada paso usa lo que creó el anterior). */
const ctx: Record<string, number | string | null> = {}
const informe: { paso: string; resultado: string; ok: boolean }[] = []
function anotar(paso: string, resultado: string) {
  informe.push({ paso, resultado, ok: true })
  console.log(`✔ ${paso} — ${resultado}`)
}

function ok<T>(res: { error: string | null; data?: T | null } | { error: string | null; success?: boolean }, que: string): void {
  if (res.error) throw new Error(`${que}: ${res.error}`)
}

async function fila<T = Record<string, unknown>>(tabla: string, col: string, id: number | string, select = "*"): Promise<T> {
  const { data, error } = await getCliente().from(tabla).select(select).eq(col, id).single()
  if (error) throw new Error(`${tabla}.${col}=${id}: ${error.message}`)
  return data as T
}

async function pdfDePrueba(titulo: string): Promise<File> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(titulo, { x: 60, y: 760, size: 16, font })
  page.drawText(`Documento de prueba generado el ${HOY} para validar el expediente.`, { x: 60, y: 730, size: 10, font })
  const bytes = await doc.save()
  return new File([bytes], `${titulo.replace(/\s+/g, "_")}.pdf`, { type: "application/pdf" })
}

describe("Flujo completo Officemart (base real)", () => {
  beforeAll(async () => {
    ctx.usuario_id = await iniciarSesion()
  })

  afterAll(() => {
    const lineas = [
      "# Validación de flujo completo (datos reales)",
      "",
      `Ejecutado el ${HOY} con \`pnpm test:integracion\` sobre la empresa del usuario de validación. Todo lo creado lleva el prefijo **VAL** para reconocerlo en las pantallas.`,
      "",
      "| # | Paso | Resultado verificado |",
      "|---|---|---|",
      ...informe.map((f, i) => `| ${i + 1} | ${f.paso} | ${f.resultado.replace(/\|/g, "/")} |`),
      "",
      "## Identificadores creados",
      "",
      "| Clave | Valor |",
      "|---|---|",
      ...Object.entries(ctx).filter(([k]) => k !== "usuario_id").map(([k, v]) => `| ${k} | ${v ?? ""} |`),
      "",
    ]
    writeFileSync("docs/VALIDACION-FLUJO-COMPLETO.md", lineas.join("\n"))
  })

  it("0. Preparación: almacén, bodega y que no exista una corrida previa", async () => {
    const { data: prev } = await getCliente().from("productos").select("id").eq("codigo_barras", "VAL-CUAD-001").maybeSingle()
    if (prev) throw new Error("Ya existe el producto VAL-CUAD-001: la validación ya se corrió. Borra los datos VAL o revisa el informe existente.")
    const alm = await getAlmacenes()
    ok(alm, "almacenes")
    const principal = alm.data.find((a) => a.nombre === "Principal") ?? alm.data[0]
    expect(principal?.id).toBeTruthy()
    const locs = await getLocalizaciones(principal!.id)
    ok(locs, "localizaciones")
    expect(locs.data.length).toBeGreaterThan(0)
    ctx.almacen_id = principal!.id!
    ctx.localizacion_id = locs.data[0].id!
    anotar("Preparación", `Almacén «${principal!.nombre}» (#${ctx.almacen_id}) y bodega «${locs.data[0].nombre}» (#${ctx.localizacion_id})`)
  })

  it("1. Crear categoría y producto terminado", async () => {
    const cat = await createCategoria("VAL Cuadernos")
    ok(cat, "categoría")
    ctx.categoria_id = cat.data!.id!
    const prod: Producto = { nombre: "VAL Cuaderno espiral 100 hojas", codigo_barras: "VAL-CUAD-001", precio_venta_sugerido: 85, categoria_id: Number(ctx.categoria_id) }
    const res = await saveProducto(prod, true)
    ok(res, "producto")
    ctx.producto_id = res.data!.id!
    const p = await fila<{ stock_total: number; precio_venta_sugerido: number }>("productos", "id", Number(ctx.producto_id))
    expect(Number(p.stock_total || 0)).toBe(0)
    expect(Number(p.precio_venta_sugerido)).toBe(85)
    anotar("Crear producto", `Producto #${ctx.producto_id} «VAL Cuaderno espiral 100 hojas», precio L 85, stock inicial 0`)
  })

  it("2. Crear proveedor y comprar materiales (entrada a inventario de materiales)", async () => {
    const prov = await saveProveedor({ nombre: "VAL Papelera Centroamericana", rtn: "08019000000001" }, true)
    ok(prov, "proveedor")
    ctx.proveedor_id = prov.data!.id!
    const mats: { clave: string; nombre: string; unidad: string; cantidad: number; costo: number }[] = [
      { clave: "mat_papel", nombre: "VAL Papel bond (hoja)", unidad: "hoja", cantidad: 20000, costo: 0.1 },
      { clave: "mat_portada", nombre: "VAL Portada cartón", unidad: "unidad", cantidad: 300, costo: 2.5 },
      { clave: "mat_espiral", nombre: "VAL Espiral metálico", unidad: "unidad", cantidad: 300, costo: 1 },
    ]
    for (const m of mats) {
      const { data, error } = await getCliente().from("materiales").insert({ nombre: m.nombre, unidad_medida: m.unidad, razon_social_id: (await fila<{ razon_social_id: number }>("usuarios", "id", String(ctx.usuario_id), "razon_social_id")).razon_social_id, usuario: "VAL" }).select("id").single()
      if (error) throw new Error(`material ${m.nombre}: ${error.message}`)
      ctx[m.clave] = (data as { id: number }).id
    }
    const compra = await createCompraMaterial({
      proveedor_id: Number(ctx.proveedor_id), moneda: "LPS", tasa_cambio: 1, costos_importacion: 0, impuestos_compra: 0, otros_costos: 0, forma_pago: "Contado",
      lineas: mats.map((m) => ({ material_id: Number(ctx[m.clave]), cantidad: m.cantidad, costo_unitario_moneda_origen: m.costo })),
    })
    ok(compra, "compra de materiales")
    ctx.compra_material_id = compra.data!.id
    const rec = await recibirCompraMaterial(compra.data!.id, Number(ctx.almacen_id), Number(ctx.localizacion_id))
    ok(rec, "recepción de materiales")
    for (const m of mats) {
      const f = await fila<{ stock_total: number; costo_promedio: number }>("materiales", "id", Number(ctx[m.clave]))
      expect(Number(f.stock_total)).toBe(m.cantidad)
      expect(Number(f.costo_promedio)).toBeCloseTo(m.costo, 4)
    }
    anotar("Compra y recepción de materiales", `Compra #${ctx.compra_material_id} (contado, L ${r2(20000 * 0.1 + 300 * 2.5 + 300)}): papel 20 000 hojas @0.10, portada 300 @2.50, espiral 300 @1.00; stock y costo promedio correctos`)
  })

  it("3. Receta del producto (consumo por unidad y costos de conversión)", async () => {
    const pf = await setProductoFabricado(Number(ctx.producto_id), true)
    ok(pf, "marcar como fabricado")
    const r = await upsertReceta({
      producto_id: Number(ctx.producto_id), estandar_unidades_por_minuto: 0.5, costo_energia: 0.5, costo_mano_obra: 3, costo_overhead: 1,
      lineas: [
        { material_id: Number(ctx.mat_papel), consumo_por_unidad: 100, costo_promedio: 0.1 },
        { material_id: Number(ctx.mat_portada), consumo_por_unidad: 1, costo_promedio: 2.5 },
        { material_id: Number(ctx.mat_espiral), consumo_por_unidad: 1, costo_promedio: 1 },
      ],
    })
    ok(r, "receta")
    const rec = await fila<{ costo_unitario_estimado: number }>("produccion_recetas", "producto_id", Number(ctx.producto_id))
    // 100×0.10 + 2.50 + 1.00 = 13.50 de material + 4.50 de conversión = 18.00
    expect(Number(rec.costo_unitario_estimado)).toBeCloseTo(18, 2)
    anotar("Receta", "100 hojas + 1 portada + 1 espiral por cuaderno; costo estimado L 18.00 (13.50 material + 4.50 conversión)")
  })

  it("4. Producción: orden, corrida (consume materiales) y carga al inventario", async () => {
    const orden = await createOrden({ producto_id: Number(ctx.producto_id), cantidad_objetivo: 100, fecha_objetivo: FIN_MES, notas: "VAL orden de validación" })
    ok(orden, "orden de producción")
    expect(orden.sinReceta).toBe(false)
    ctx.orden_id = orden.data!.id
    const corr = await createCorrida({ orden_id: orden.data!.id, producto_id: Number(ctx.producto_id), operador: "VAL Operador", unidades_buenas: 100, unidades_defectuosas: 0, tiempo_planificado_minutos: 200 })
    ok(corr, "corrida")
    ctx.corrida_id = corr.data!.id
    const ej = await ejecutarCorrida(corr.data!.id)
    ok(ej, "ejecutar corrida")
    const papel = await fila<{ stock_total: number }>("materiales", "id", Number(ctx.mat_papel))
    const portada = await fila<{ stock_total: number }>("materiales", "id", Number(ctx.mat_portada))
    expect(Number(papel.stock_total)).toBe(10000)
    expect(Number(portada.stock_total)).toBe(200)
    const rc = await recibirCorrida(corr.data!.id, Number(ctx.almacen_id), Number(ctx.localizacion_id))
    ok(rc, "recibir corrida en inventario")
    const cor = await fila<{ estado: string; costo_unitario_real: number }>("produccion_corridas", "id", corr.data!.id)
    expect(cor.estado).toBe("Recibida")
    const p = await fila<{ stock_total: number; costo_promedio: number }>("productos", "id", Number(ctx.producto_id))
    expect(Number(p.stock_total)).toBe(100)
    expect(Number(p.costo_promedio)).toBeCloseTo(Number(cor.costo_unitario_real), 2)
    ctx.costo_unitario_producido = r2(Number(cor.costo_unitario_real))
    const { data: kx } = await getCliente().from("transacciones_inventario").select("tipo_movimiento, cantidad").eq("producto_id", Number(ctx.producto_id))
    expect((kx || []).some((k: { tipo_movimiento: string; cantidad: number }) => k.tipo_movimiento === "Entrada Produccion" && Number(k.cantidad) === 100)).toBe(true)
    await setEstadoOrden(orden.data!.id, "Cerrada")
    anotar("Producción y cargue de inventario", `Orden #${ctx.orden_id}, corrida #${ctx.corrida_id}: consumió 10 000 hojas, 100 portadas y 100 espirales; entraron 100 cuadernos al inventario a costo real L ${ctx.costo_unitario_producido} (kardex «Entrada Produccion» +100)`)
  })

  it("5. Tesorería: cuenta bancaria y apertura de caja", async () => {
    const cuenta = await saveCuenta({ nombre: "VAL Banco Atlántida", tipo: "Banco", porcentaje_comision: 0, activo: true }, true)
    ok(cuenta, "cuenta bancaria")
    ctx.cuenta_id = cuenta.data!.id!
    // Saldo inicial con fecha pasada (1.º del mes): prueba el recálculo de la cadena de saldos.
    const apertura = await registrarMovimientoCuenta({ cuenta_id: Number(ctx.cuenta_id), tipo: "Ingreso", monto: 60000, concepto: "VAL Saldo inicial / aporte de capital", fecha: `${INICIO_MES}T08:00:00.000Z`, referencia: "VAL-APERTURA" })
    ok(apertura, "saldo inicial del banco")
    const ses = await getSesionAbierta()
    if (!ses.data?.id) {
      const ab = await abrirSesion(1000)
      ok(ab, "apertura de caja")
      ctx.caja_sesion_id = ab.data!.id!
    } else ctx.caja_sesion_id = ses.data.id
    ctx.caja_saldo_antes_venta = await getSaldoActualSesionAbierta()
    anotar("Tesorería", `Cuenta «VAL Banco Atlántida» #${ctx.cuenta_id} con saldo inicial L 60 000 al ${INICIO_MES}; caja abierta (sesión #${ctx.caja_sesion_id}) con saldo L ${ctx.caja_saldo_antes_venta}`)
  })

  it("6. Venta con ISV y pago mixto (efectivo + banco) que descuenta inventario", async () => {
    const cli = await saveCliente({ nombre: "VAL Distribuidora Escolar S. de R.L.", rtn: "08019000000002", telefono: "2222-0000" }, true)
    ok(cli, "cliente")
    ctx.cliente_id = cli.data!.id!
    const cantidad = 30
    const precio = 85
    const costo = Number(ctx.costo_unitario_producido)
    const subtotal = r2(cantidad * precio)
    const isv = r2(subtotal * 0.15)
    const total = r2(subtotal + isv)
    const efectivo = 1000
    const banco = r2(total - efectivo)
    const venta = await crearVenta({
      encabezado: {
        numero_factura: "", cliente_id: Number(ctx.cliente_id), almacen_id: Number(ctx.almacen_id), aplica_impuesto: true, porcentaje_impuesto: 15, descuento: 0,
        subtotal, impuesto_total: isv, total_venta: total, estado_pago: "Pagado", valorpago: total,
      },
      detalles: [{ producto_id: Number(ctx.producto_id), cantidad, precio_unitario: precio, costo_promedio_momento: costo, utilidad_linea: r2((precio - costo) * cantidad) }],
      almacen_id: Number(ctx.almacen_id),
      localizacion_id: Number(ctx.localizacion_id),
      pagos_detalle: [
        { metodo_pago: "Efectivo", monto_bruto: efectivo },
        { metodo_pago: "Banco", cuenta_id: Number(ctx.cuenta_id), monto_bruto: banco, porcentaje_comision: 0 },
      ],
    })
    ok(venta, "venta")
    ctx.venta_id = venta.data!.id!
    ctx.venta_numero = venta.data!.numero_factura
    ctx.venta_total = total
    const enc = await fila<{ total_venta: number; estado_pago: string; valorpago: number }>("ventas_encabezado", "id", Number(ctx.venta_id))
    expect(Number(enc.total_venta)).toBeCloseTo(total, 2)
    expect(enc.estado_pago).toBe("Pagado")
    const p = await fila<{ stock_total: number }>("productos", "id", Number(ctx.producto_id))
    expect(Number(p.stock_total)).toBe(70)
    const { data: kx } = await getCliente().from("transacciones_inventario").select("tipo_movimiento, cantidad, referencia_id").eq("producto_id", Number(ctx.producto_id)).eq("tipo_movimiento", "Salida Venta")
    expect((kx || []).some((k: { cantidad: number; referencia_id: number }) => Number(k.cantidad) === -30 && Number(k.referencia_id) === Number(ctx.venta_id))).toBe(true)
    const cajaDespues = await getSaldoActualSesionAbierta()
    expect(r2(cajaDespues - Number(ctx.caja_saldo_antes_venta))).toBeCloseTo(efectivo, 2)
    const { data: movBanco } = await getCliente().from("cuenta_movimientos").select("monto, tipo, concepto").eq("cuenta_id", Number(ctx.cuenta_id)).eq("ref_tipo", "venta")
    const movVenta = (movBanco || []).find((m: { monto: number }) => Math.abs(Number(m.monto) - banco) < 0.01) as { concepto: string } | undefined
    expect(movVenta).toBeTruthy()
    expect(movVenta!.concepto).toContain(String(ctx.venta_numero))
    anotar("Venta y descuento de inventario", `Factura ${ctx.venta_numero} (#${ctx.venta_id}): 30 × L 85 = L ${subtotal} + ISV L ${isv} = L ${total}; pagó L ${efectivo} efectivo + L ${banco} banco. Stock 100 → 70, kardex «Salida Venta» −30, caja +L ${efectivo}, banco +L ${banco}`)
  })

  it("7. Historial de ventas muestra la factura", async () => {
    const res = await getVentas({ limit: 50 })
    ok(res, "historial")
    const v = res.data.find((x) => x.id === Number(ctx.venta_id))
    expect(v).toBeTruthy()
    expect(v!.cliente_nombre).toContain("VAL Distribuidora")
    anotar("Historial de ventas", `La factura ${ctx.venta_numero} aparece en el historial con cliente «${v!.cliente_nombre}» y total L ${v!.total_venta}`)
  })

  it("8. Gastos: uno pagado por banco y uno a crédito (CxP)", async () => {
    async function concepto(nombre: string, categoria: CategoriaMacro): Promise<number> {
      const { data } = await getConceptosGasto()
      const ex = (data || []).find((c) => c.nombre === nombre)
      if (ex?.id) return ex.id
      const cr = await createConceptoGasto({ nombre, categoria_macro: categoria })
      ok(cr, `concepto ${nombre}`)
      return cr.data!.id!
    }
    const cEnergia = await concepto("VAL Energía eléctrica", "Servicios")
    const cAlquiler = await concepto("VAL Alquiler de local", "Arriendo")
    const g1 = await createGasto({ concepto_id: cEnergia, fecha_gasto: HOY, monto: 1500, metodo_pago: "Transferencia", descripcion: "VAL factura ENEE", pagar_ahora: true, pago_metodo: "Banco", pago_cuenta_id: Number(ctx.cuenta_id) })
    ok(g1, "gasto pagado")
    const g2 = await createGasto({ concepto_id: cAlquiler, fecha_gasto: HOY, monto: 8000, metodo_pago: "Transferencia", descripcion: "VAL alquiler del mes", proveedor_id: Number(ctx.proveedor_id), fecha_vencimiento: FIN_MES, pagar_ahora: false })
    ok(g2, "gasto a crédito")
    ctx.gasto_energia_id = g1.data!.id!
    ctx.gasto_alquiler_id = g2.data!.id!
    const e1 = await fila<{ estado_pago: string }>("gastos", "id", Number(ctx.gasto_energia_id))
    expect(e1.estado_pago).toBe("Pagado")
    const cxp = await getCuentasPorPagar()
    expect((cxp.data || []).some((d: { id?: number }) => d.id === Number(ctx.gasto_alquiler_id))).toBe(true)
    anotar("Gastos", `Gasto #${ctx.gasto_energia_id} Energía L 1 500 pagado por banco; gasto #${ctx.gasto_alquiler_id} Alquiler L 8 000 a crédito (aparece en CxP, vence ${FIN_MES})`)
  })

  it("9. Estado de resultados del mes (antes de nómina)", async () => {
    const er = await getEstadoResultadosMensual(ANIO, MES)
    ok(er, "estado de resultados")
    const d = er.data!
    const subtotal = r2(30 * 85)
    const cmv = r2(30 * Number(ctx.costo_unitario_producido))
    // Ventas SIN ISV (en una empresa sin otras ventas del mes, exactamente el subtotal).
    expect(d.ventas_totales).toBeGreaterThanOrEqual(subtotal - 0.01)
    const { count: otrasVentas } = await getCliente().from("ventas_encabezado").select("id", { count: "exact", head: true }).gte("fecha_venta", INICIO_MES).is("anulada_at", null)
    if (otrasVentas === 1) expect(d.ventas_totales).toBeCloseTo(subtotal, 2)
    expect(d.costo_mercancia_vendida).toBeGreaterThanOrEqual(cmv - 0.01)
    expect(d.gastos_servicios).toBeGreaterThanOrEqual(1500 - 0.01)
    expect(d.gastos_arriendo).toBeGreaterThanOrEqual(8000 - 0.01)
    ctx.er_ventas = d.ventas_totales
    ctx.er_utilidad_neta_antes_nomina = d.utilidad_neta
    anotar("Estado de resultados (antes de nómina)", `${d.mes_nombre} ${ANIO}: ventas L ${d.ventas_totales}, CMV L ${d.costo_mercancia_vendida}, utilidad bruta L ${d.utilidad_bruta}, servicios L ${d.gastos_servicios}, arriendo L ${d.gastos_arriendo}, utilidad neta L ${d.utilidad_neta}`)
  })

  it("10. Ingreso de personal", async () => {
    const e: Empleado = {
      codigo: "VAL-E001", nombre: "VAL María Fernanda López", identidad: "0801-1990-12345", fecha_nacimiento: "1990-05-14", telefono: "9999-0000", correo: "val.maria@example.com",
      puesto: "Operaria de producción", departamento: "Producción", fecha_ingreso: "2024-03-01", tipo_contrato: "Permanente", salario_mensual: 25000,
      frecuencia_pago: "Mensual", forma_pago: "Transferencia", banco: "Banco Atlántida", cuenta_bancaria: "VAL-000123", ihss_afiliacion: "VAL-IHSS-1", rap_afiliacion: "VAL-RAP-1",
      aplica_ihss: true, aplica_rap: true, aplica_isr: true, estado: "Activo",
    }
    const res = await saveEmpleado(e)
    ok(res, "empleado")
    ctx.empleado_id = res.data!.id!
    anotar("Ingreso de personal", `Empleada #${ctx.empleado_id} «VAL María Fernanda López», ingreso 01/03/2024, salario L 25 000 mensual`)
  })

  it("11. Causación de vacaciones", async () => {
    const s = await getSaldosVacaciones({ empleadoId: Number(ctx.empleado_id) })
    ok(s, "saldo de vacaciones")
    const v = s.data[0]
    // 2 años completos (10 + 12) + proporcional del 3.er año (15 días)
    expect(v.anios_completos).toBe(2)
    expect(v.causado_exigible).toBe(22)
    expect(v.causado_proporcional).toBeGreaterThan(0)
    expect(v.causado_proporcional).toBeLessThan(15)
    ctx.vacaciones_causadas = v.causado_total
    anotar("Causación de vacaciones", `${v.anios_completos} años completos: 22 días exigibles + ${v.causado_proporcional} proporcionales = ${v.causado_total} días (salario diario L ${v.salario_diario})`)
  })

  it("12. Vacaciones gozadas y liquidación de vacaciones", async () => {
    const goz = await registrarVacaciones({ empleado_id: Number(ctx.empleado_id), modo: "gozadas", dias: 5, fecha: INICIO_MES, descripcion: "VAL descanso" })
    ok(goz, "vacaciones gozadas")
    const exceso = await registrarVacaciones({ empleado_id: Number(ctx.empleado_id), modo: "pagadas", dias: 999, fecha: HOY })
    expect(exceso.error).toMatch(/saldo/i)
    const pag = await registrarVacaciones({ empleado_id: Number(ctx.empleado_id), modo: "pagadas", dias: 3, fecha: HOY, descripcion: "VAL liquidación parcial" })
    ok(pag, "liquidación de vacaciones")
    ctx.novedad_vacaciones_pagadas_id = pag.data!.id!
    const s = await getSaldosVacaciones({ empleadoId: Number(ctx.empleado_id) })
    const v = s.data[0]
    expect(v.gozados).toBe(5)
    expect(v.pagados).toBe(3)
    expect(v.saldo).toBeCloseTo(Number(ctx.vacaciones_causadas) - 8, 2)
    ctx.vacaciones_saldo = v.saldo
    anotar("Vacaciones gozadas y liquidación", `5 días gozados + 3 días liquidados (se pagan en nómina a L ${v.salario_diario}/día = L ${r2(3 * v.salario_diario)}); saldo ${v.saldo} días. Liquidar más que el saldo se rechaza`)
  })

  it("13. Subida de archivos al expediente del empleado (bucket privado)", async () => {
    const f1 = await pdfDePrueba("VAL Contrato de trabajo")
    const f2 = await pdfDePrueba("VAL Copia de identidad")
    const d1 = await subirDocumentoEmpleado(Number(ctx.empleado_id), f1, { tipo: "Contrato", nombre: "VAL Contrato de trabajo" })
    ok(d1, "subir contrato")
    const d2 = await subirDocumentoEmpleado(Number(ctx.empleado_id), f2, { tipo: "Identidad", nombre: "VAL Copia de identidad", vence_en: `${ANIO + 5}-05-14` })
    ok(d2, "subir identidad")
    const lista = await getDocumentosEmpleado(Number(ctx.empleado_id))
    expect(lista.data.length).toBe(2)
    const url = await urlDocumentoEmpleado(d1.data!.archivo_path)
    ok(url, "url firmada")
    const descarga = await fetch(url.url!)
    expect(descarga.ok).toBe(true)
    expect((await descarga.arrayBuffer()).byteLength).toBe(f1.size)
    anotar("Expediente del empleado", `2 PDF subidos al bucket privado (contrato e identidad con vencimiento); se descargan con URL firmada temporal y el tamaño coincide`)
  })

  it("14. Novedades del mes: horas extra y bono", async () => {
    const he = await saveNovedad({ empleado_id: Number(ctx.empleado_id), tipo: "Horas extra diurna", fecha: HOY, cantidad: 4, monto: null, gravable: true, cotizable: true, descripcion: "VAL cierre de pedido" })
    ok(he, "horas extra")
    const bono = await saveNovedad({ empleado_id: Number(ctx.empleado_id), tipo: "Bono", fecha: HOY, cantidad: null, monto: 1000, gravable: true, cotizable: true, descripcion: "VAL bono de productividad" })
    ok(bono, "bono")
    anotar("Novedades", "4 horas extra diurnas y bono de L 1 000")
  })

  it("15. Liquidación de nómina: generar, revisar, aprobar y pagar", async () => {
    const saldoBancoAntes = Number((await getCuentas()).data.find((c) => c.id === Number(ctx.cuenta_id))?.saldo || 0)
    const gen = await generarNomina({ tipo: "Mensual", desde: INICIO_MES, hasta: FIN_MES, fecha_pago: FIN_MES, notas: "VAL nómina de validación" })
    ok(gen, "generar nómina")
    ctx.nomina_id = gen.data!.id
    const comp = await getNominaCompleta(gen.data!.id)
    ok(comp, "nómina completa")
    const d = comp.data!.detalle.find((x) => x.empleado_id === Number(ctx.empleado_id))!
    expect(d).toBeTruthy()
    // 25 000 salario + horas extra 4 × (25 000/240) × 1.25 + bono 1 000 + vacaciones 3 × 833.33
    const heEsperado = r2(4 * (25000 / 240) * 1.25)
    const vacEsperado = r2(3 * (25000 / 30))
    expect(d.salario_periodo).toBe(25000)
    expect(d.horas_extra).toBeCloseTo(heEsperado, 2)
    expect(d.otros_ingresos).toBeCloseTo(1000 + vacEsperado, 2)
    expect(d.ihss_empleado).toBe(595.16)
    expect(d.neto).toBeCloseTo(d.total_devengado - d.total_deducciones, 2)
    expect(d.lineas.some((l) => l.concepto.startsWith("Vacaciones pagadas"))).toBe(true)
    const { data: novs } = await getCliente().from("rrhh_novedades").select("id, nomina_id, tipo").eq("empleado_id", Number(ctx.empleado_id))
    expect((novs || []).every((n: { nomina_id: number | null }) => n.nomina_id === gen.data!.id)).toBe(true)
    ok(await aprobarNomina(gen.data!.id), "aprobar nómina")
    const pago = await pagarNomina(gen.data!.id, { metodo: "Banco", cuenta_id: Number(ctx.cuenta_id), fecha: FIN_MES > HOY ? HOY : FIN_MES })
    ok(pago, "pagar nómina")
    const n = await fila<{ estado: string; total_neto: number; gasto_id: number }>("rrhh_nominas", "id", gen.data!.id)
    expect(n.estado).toBe("Pagada")
    const saldoBancoDespues = Number((await getCuentas()).data.find((c) => c.id === Number(ctx.cuenta_id))?.saldo || 0)
    expect(r2(saldoBancoAntes - saldoBancoDespues)).toBeCloseTo(Number(n.total_neto), 2)
    ctx.nomina_gasto_id = n.gasto_id
    ctx.nomina_neto = Number(n.total_neto)
    anotar("Liquidación de nómina", `Nómina #${ctx.nomina_id} (${INICIO_MES} a ${FIN_MES}): devengado L ${d.total_devengado} (salario 25 000 + horas extra ${heEsperado} + bono 1 000 + vacaciones ${vacEsperado}); IHSS ${d.ihss_empleado}, RAP ${d.rap_empleado}, ISR ${d.isr}; neto L ${d.neto}; patronal L ${r2(d.ihss_patronal + d.rap_patronal)}. Aprobada y pagada por banco (saldo bajó L ${n.total_neto}); gasto #${n.gasto_id}`)
  })

  it("16. Estado de resultados final y balance operativo", async () => {
    const er = await getEstadoResultadosMensual(ANIO, MES)
    ok(er, "estado de resultados")
    const d = er.data!
    expect(d.gastos_nomina).toBeGreaterThanOrEqual(Number(ctx.nomina_neto) - 0.01)
    expect(d.utilidad_neta).toBeLessThan(Number(ctx.er_utilidad_neta_antes_nomina))
    const bal = await getBalanceOperativo()
    ok(bal, "balance")
    const inv = bal.data!.activos.find((a) => a.clave === "inventario")!
    expect(inv.monto).toBeGreaterThanOrEqual(r2(70 * Number(ctx.costo_unitario_producido)) - 0.01)
    const mats = bal.data!.activos.find((a) => a.clave === "materiales")!
    expect(mats.monto).toBeGreaterThanOrEqual(r2(10000 * 0.1 + 200 * 2.5 + 200 * 1) - 0.01)
    anotar("Estado de resultados y balance", `Resultados ${d.mes_nombre}: ventas L ${d.ventas_totales}, CMV L ${d.costo_mercancia_vendida}, nómina L ${d.gastos_nomina}, gastos operativos L ${r2(d.total_gastos_operativos)}, utilidad neta L ${r2(d.utilidad_neta)}. Balance: inventario L ${inv.monto}, materiales L ${mats.monto}, activos L ${bal.data!.totalActivos}, pasivos L ${bal.data!.totalPasivos}, patrimonio L ${bal.data!.patrimonio}`)
  })
})

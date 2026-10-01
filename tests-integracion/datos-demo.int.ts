/**
 * DATOS DE DEMOSTRACIÓN para Office Mart (julio–septiembre 2026). Crea, con las
 * mismas funciones que usan las pantallas: vendedores y zonas, clientes,
 * proveedores, catálogo, compras con recepción, materiales y producción,
 * ventas repartidas en tres meses, abonos, gastos, empleados con asistencia,
 * novedades y nóminas, cotizaciones y CRM.
 *
 *   pnpm test:integracion datos-demo
 *
 * Reanudable: cada paso comprueba si sus datos ya existen y los reutiliza, así
 * que volver a correrlo no duplica. Guía de la demo en docs/DATOS-DEMO.md;
 * conteo de la última corrida en docs/DATOS-DEMO-ULTIMA-CORRIDA.md.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { writeFileSync } from "node:fs"

vi.mock("@/lib/supabase/client", async () => {
  const mod = await import("./cliente")
  return { createClient: () => mod.getCliente(), isSupabaseConfigured: () => true }
})

import { getCliente, iniciarSesion } from "./cliente"
import { getAlmacenes, getLocalizaciones, createCategoria, saveProducto, saveCliente, saveProveedor } from "@/lib/services/catalogos"
import { saveVendedor, saveZona } from "@/lib/services/vendedores"
import { createCompra, procesarRecepcion } from "@/lib/services/compras"
import { createCompraMaterial, recibirCompraMaterial } from "@/lib/services/produccion-compras"
import { upsertReceta } from "@/lib/services/produccion-recetas"
import { setProductoFabricado } from "@/lib/services/productos-fabricados"
import { createOrden, setEstadoOrden } from "@/lib/services/produccion-ordenes"
import { createCorrida, ejecutarCorrida } from "@/lib/services/produccion-corridas"
import { recibirCorrida } from "@/lib/services/produccion-recepcion"
import { saveCuenta, getCuentas, registrarMovimientoCuenta } from "@/lib/services/cuentas"
import { getSesionAbierta, abrirSesion } from "@/lib/services/caja-chica"
import { crearVenta, registrarPago } from "@/lib/services/ventas"
import { getConceptosGasto, createConceptoGasto, createGasto, type CategoriaMacro } from "@/lib/services/gastos"
import { savePoliticaComision } from "@/lib/services/comisiones"
import { saveEmpleado, saveMarcacion, saveNovedad, registrarVacaciones, type Empleado, type TipoNovedad } from "@/lib/services/rrhh"
import { generarNomina, aprobarNomina, pagarNomina } from "@/lib/services/nomina"
import { crearCotizacion, cambiarEstadoCotizacion } from "@/lib/services/cotizaciones"
import { getEtapas, crearOportunidad, cerrarOportunidad, crearActividad, saveContacto, type TipoActividad } from "@/lib/services/crm"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"

// ---------- utilidades ----------
const r2 = (n: number) => +(Number(n) || 0).toFixed(2)
const HOY = getHondurasTodayISODate()

/** PRNG determinístico (mulberry32): la misma semilla produce los mismos datos. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = prng(20260929)
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
const elegir = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]

function sumarDias(iso: string, d: number): string {
  const [y, m, dd] = iso.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, dd + d))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`
}
const esHabil = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number)
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return w !== 0
}
const ts = (fecha: string, h: number, min = 0) => `${fecha}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00.000Z`

function ok(res: { error: string | null }, que: string): void {
  if (res.error) throw new Error(`${que}: ${res.error}`)
}

const conteo: Record<string, number> = {}
const suma = (k: string, n = 1) => { conteo[k] = (conteo[k] || 0) + n }
const ids: Record<string, number> = {}

// ---------- catálogo base ----------
const CATEGORIAS = ["Papelería", "Tecnología", "Impresión y artes gráficas", "Mobiliario de oficina", "Limpieza y cafetería"]

interface ProdDemo { nombre: string; codigo: string; categoria: string; costo: number; precio: number; compra: number }
const PRODUCTOS: ProdDemo[] = [
  { nombre: "Papel bond carta 75 g (resma 500)", codigo: "PAP-001", categoria: "Papelería", costo: 78, precio: 115, compra: 300 },
  { nombre: "Papel bond oficio 75 g (resma 500)", codigo: "PAP-002", categoria: "Papelería", costo: 92, precio: 135, compra: 150 },
  { nombre: "Bolígrafo azul punta media (caja 12)", codigo: "PAP-003", categoria: "Papelería", costo: 38, precio: 65, compra: 200 },
  { nombre: "Folder manila tamaño carta (caja 100)", codigo: "PAP-004", categoria: "Papelería", costo: 145, precio: 220, compra: 80 },
  { nombre: "Engrapadora metálica de escritorio", codigo: "PAP-005", categoria: "Papelería", costo: 110, precio: 185, compra: 60 },
  { nombre: "Cuaderno profesional 100 hojas", codigo: "PAP-006", categoria: "Papelería", costo: 32, precio: 55, compra: 400 },
  { nombre: "Marcador permanente negro (caja 12)", codigo: "PAP-007", categoria: "Papelería", costo: 95, precio: 150, compra: 100 },
  { nombre: "Tóner compatible HP 85A", codigo: "TEC-001", categoria: "Tecnología", costo: 420, precio: 690, compra: 60 },
  { nombre: "Mouse inalámbrico USB", codigo: "TEC-002", categoria: "Tecnología", costo: 180, precio: 320, compra: 50 },
  { nombre: "Teclado USB en español", codigo: "TEC-003", categoria: "Tecnología", costo: 210, precio: 360, compra: 40 },
  { nombre: "Memoria USB 64 GB", codigo: "TEC-004", categoria: "Tecnología", costo: 140, precio: 245, compra: 80 },
  { nombre: "Regulador de voltaje 1000 VA", codigo: "TEC-005", categoria: "Tecnología", costo: 690, precio: 1150, compra: 20 },
  { nombre: "Silla ergonómica de oficina", codigo: "MOB-001", categoria: "Mobiliario de oficina", costo: 1850, precio: 3200, compra: 15 },
  { nombre: "Archivero metálico 4 gavetas", codigo: "MOB-002", categoria: "Mobiliario de oficina", costo: 3400, precio: 5600, compra: 8 },
  { nombre: "Escritorio ejecutivo 1.40 m", codigo: "MOB-003", categoria: "Mobiliario de oficina", costo: 2900, precio: 4900, compra: 10 },
  { nombre: "Café molido 1 lb", codigo: "LIM-001", categoria: "Limpieza y cafetería", costo: 95, precio: 150, compra: 120 },
  { nombre: "Papel higiénico jumbo (fardo 12)", codigo: "LIM-002", categoria: "Limpieza y cafetería", costo: 310, precio: 460, compra: 60 },
  { nombre: "Desinfectante multiusos galón", codigo: "LIM-003", categoria: "Limpieza y cafetería", costo: 85, precio: 140, compra: 90 },
]

const FABRICADOS = [
  { clave: "talonario", nombre: "Talonario de facturas 50 juegos (impreso)", codigo: "IMP-001", precio: 185, cantidad: 240 },
  { clave: "tarjetas", nombre: "Tarjetas de presentación full color (caja 500)", codigo: "IMP-002", precio: 450, cantidad: 90 },
]

const CLIENTES = [
  { nombre: "Grupo Industrial del Valle de Sula", rtn: "05019001234567", telefono: "2550-1100", zona: "San Pedro Sula" },
  { nombre: "Colegio Bilingüe Los Pinares", rtn: "08019002345671", telefono: "2231-4455", zona: "Tegucigalpa" },
  { nombre: "Clínica Médica Santa Fe", rtn: "08019003456712", telefono: "2239-8877", zona: "Tegucigalpa" },
  { nombre: "Ferretería El Constructor", rtn: "05019004567123", telefono: "2557-2020", zona: "San Pedro Sula" },
  { nombre: "Despacho Contable Rivera & Asociados", rtn: "08019005671234", telefono: "2232-6060", zona: "Tegucigalpa" },
  { nombre: "Alcaldía Municipal de La Lima", rtn: "05019006712345", telefono: "2668-1000", zona: "San Pedro Sula" },
  { nombre: "Hotel Plaza Copán", rtn: "05019007123456", telefono: "2552-3030", zona: "San Pedro Sula" },
  { nombre: "Universidad Tecnológica del Norte", rtn: "05019008234567", telefono: "2545-9090", zona: "San Pedro Sula" },
  { nombre: "Banco Comunal Esperanza", rtn: "08019009345678", telefono: "2238-7070", zona: "Tegucigalpa" },
  { nombre: "Distribuidora Agrícola Olancho", rtn: "15019001456789", telefono: "2785-2211", zona: "Juticalpa" },
  { nombre: "Farmacia La Económica", rtn: "15019002567891", telefono: "2785-4433", zona: "Juticalpa" },
  { nombre: "Constructora Honducasa", rtn: "08019003678912", telefono: "2235-1212", zona: "Tegucigalpa" },
  { nombre: "Restaurante El Fogón Catracho", rtn: "05019004789123", telefono: "2553-8080", zona: "San Pedro Sula" },
  { nombre: "Instituto Técnico Honduras", rtn: "08019005891234", telefono: "2236-5656", zona: "Tegucigalpa" },
]

const PROVEEDORES = [
  { nombre: "Distribuidora Papelera de Honduras", rtn: "08019010000011" },
  { nombre: "TecnoImport Centroamérica", rtn: "05019010000022" },
  { nombre: "Muebles y Oficinas S.A.", rtn: "08019010000033" },
  { nombre: "Suministros Industriales del Norte", rtn: "05019010000044" },
]

const EMPLEADOS: Omit<Empleado, "tipo_contrato" | "forma_pago" | "aplica_ihss" | "aplica_rap" | "aplica_isr" | "estado">[] = [
  { codigo: "E-001", nombre: "Carlos Alberto Mejía Paz", puesto: "Gerente general", departamento: "Administración", fecha_ingreso: "2019-02-01", salario_mensual: 48000, frecuencia_pago: "Mensual", identidad: "0801-1982-01234" },
  { codigo: "E-002", nombre: "Ana Lucía Hernández Rivera", puesto: "Contadora", departamento: "Administración", fecha_ingreso: "2020-06-15", salario_mensual: 32000, frecuencia_pago: "Mensual", identidad: "0801-1988-02345" },
  { codigo: "E-003", nombre: "José Manuel Castillo Flores", puesto: "Ejecutivo de ventas", departamento: "Ventas", fecha_ingreso: "2021-03-01", salario_mensual: 22000, frecuencia_pago: "Mensual", identidad: "0501-1990-03456" },
  { codigo: "E-004", nombre: "Karla Patricia Zelaya Ramos", puesto: "Ejecutiva de ventas", departamento: "Ventas", fecha_ingreso: "2022-08-01", salario_mensual: 22000, frecuencia_pago: "Mensual", identidad: "0801-1993-04567" },
  { codigo: "E-005", nombre: "Luis Fernando Oseguera Díaz", puesto: "Ejecutivo de ventas", departamento: "Ventas", fecha_ingreso: "2024-01-15", salario_mensual: 20000, frecuencia_pago: "Mensual", identidad: "1501-1995-05678" },
  { codigo: "E-006", nombre: "Sofía Alejandra Pineda Cruz", puesto: "Cajera", departamento: "Ventas", fecha_ingreso: "2023-05-02", salario_mensual: 14500, frecuencia_pago: "Quincenal", identidad: "0801-1998-06789" },
  { codigo: "E-007", nombre: "Mario Roberto Aguilar Soto", puesto: "Operador de imprenta", departamento: "Producción", fecha_ingreso: "2021-11-01", salario_mensual: 16500, frecuencia_pago: "Quincenal", identidad: "0501-1991-07891" },
  { codigo: "E-008", nombre: "Denis Josué Martínez Lara", puesto: "Diseñador gráfico", departamento: "Producción", fecha_ingreso: "2022-02-14", salario_mensual: 19000, frecuencia_pago: "Quincenal", identidad: "0801-1994-08912" },
  { codigo: "E-009", nombre: "Rosa Elvira Murillo Banegas", puesto: "Encargada de bodega", departamento: "Operaciones", fecha_ingreso: "2020-09-01", salario_mensual: 15500, frecuencia_pago: "Quincenal", identidad: "0801-1987-09123" },
  { codigo: "E-010", nombre: "Kevin Adalid Ordóñez Rápalo", puesto: "Motorista repartidor", departamento: "Operaciones", fecha_ingreso: "2025-04-07", salario_mensual: 13500, frecuencia_pago: "Quincenal", identidad: "0501-1999-10234" },
]

describe("Datos de demostración Office Mart", () => {
  let almacenId = 0
  let locId = 0
  let tenant = 0
  const prodId: Record<string, number> = {}
  const prodCosto: Record<string, number> = {}
  const prodPrecio: Record<string, number> = {}
  const stock: Record<string, number> = {}
  const clienteIds: number[] = []
  const clienteZona: Record<number, number> = {}
  const vendedorIds: number[] = []
  const provIds: number[] = []
  const empleadoIds: Record<string, number> = {}
  let cuentaId = 0
  const ventasCredito: { id: number; total: number; fecha: string }[] = []
  /** true si los pasos 1–5 ya se cargaron en una corrida anterior (se reanuda). */
  let reanudar = false
  const existe = async (tabla: string, col: string, valor: string | number) => {
    const { data } = await getCliente().from(tabla).select("id").eq(col, valor).limit(1)
    return (data || []).length > 0
  }

  beforeAll(async () => {
    const uid = await iniciarSesion()
    const { data } = await getCliente().from("usuarios").select("razon_social_id").eq("id", uid).single()
    tenant = Number((data as { razon_social_id: number }).razon_social_id)
  })

  afterAll(() => {
    const total = Object.values(conteo).reduce((a, b) => a + b, 0)
    const lineas = [
      "# Datos de demostración Office Mart",
      "",
      `Cargados el ${HOY} con \`pnpm test:integracion datos-demo\` usando las funciones de la app. Período de movimientos: julio a septiembre de 2026. Total de registros principales: **${total}**.`,
      "",
      "| Tipo de registro | Cantidad |",
      "|---|---|",
      ...Object.entries(conteo).map(([k, v]) => `| ${k} | ${v} |`),
      "",
    ]
    writeFileSync("docs/DATOS-DEMO-ULTIMA-CORRIDA.md", lineas.join("\n"))
    console.log(lineas.join("\n"))
  })

  it("0. Preparación y control de duplicados", async () => {
    const alm = await getAlmacenes()
    const principal = alm.data.find((a) => a.nombre === "Principal") ?? alm.data[0]
    almacenId = principal.id!
    const locs = await getLocalizaciones(almacenId)
    locId = locs.data[0].id!
    expect(almacenId).toBeGreaterThan(0)

    // ¿Corrida anterior? Recupera los ids para continuar sin duplicar.
    const { data: prodPrev } = await getCliente().from("productos").select("id, codigo_barras, precio_venta_sugerido, costo_promedio, stock_total").in("codigo_barras", [...PRODUCTOS.map((p) => p.codigo), ...FABRICADOS.map((p) => p.codigo)])
    if ((prodPrev || []).length === PRODUCTOS.length + FABRICADOS.length) {
      reanudar = true
      for (const p of prodPrev as { id: number; codigo_barras: string; precio_venta_sugerido: number; costo_promedio: number; stock_total: number }[]) {
        prodId[p.codigo_barras] = p.id
        prodPrecio[p.codigo_barras] = Number(p.precio_venta_sugerido)
        prodCosto[p.codigo_barras] = Number(p.costo_promedio)
        stock[p.codigo_barras] = Number(p.stock_total)
      }
      const { data: cls } = await getCliente().from("clientes").select("id, nombre, vendedor_id").in("nombre", CLIENTES.map((c) => c.nombre))
      for (const c of CLIENTES) {
        const row = (cls as { id: number; nombre: string; vendedor_id: number }[]).find((x) => x.nombre === c.nombre)!
        clienteIds.push(row.id)
        clienteZona[row.id] = row.vendedor_id
      }
      const { data: vs } = await getCliente().from("vendedores").select("id, nombre").order("id")
      for (const v of (vs || []) as { id: number }[]) vendedorIds.push(v.id)
      const { data: pv } = await getCliente().from("proveedores").select("id, nombre").in("nombre", PROVEEDORES.map((p) => p.nombre))
      for (const p of PROVEEDORES) provIds.push((pv as { id: number; nombre: string }[]).find((x) => x.nombre === p.nombre)!.id)
      const { data: cs } = await getCliente().from("cuentas_config").select("id, nombre")
      cuentaId = (cs as { id: number; nombre: string }[]).find((c) => c.nombre.startsWith("Banco Atlántida · "))!.id
      ids.cuenta = cuentaId
      ids.cuenta_pos = (cs as { id: number; nombre: string }[]).find((c) => c.nombre.startsWith("BAC · "))!.id
      console.log("Reanudando: catálogo, clientes, compras y producción ya cargados.")
    }
  })

  it("1. Vendedores, zonas, clientes, proveedores y políticas de comisión", async () => {
    if (reanudar) return
    const zonaIds: Record<string, number> = {}
    for (const [nombre, ciudad] of [["San Pedro Sula", "San Pedro Sula"], ["Tegucigalpa", "Distrito Central"], ["Juticalpa", "Olancho"]]) {
      const z = await saveZona({ nombre, ciudad, activo: true }, true)
      ok(z, `zona ${nombre}`)
      zonaIds[nombre] = z.data!.id!
      suma("Zonas de venta")
    }
    for (const nombre of ["José Manuel Castillo", "Karla Patricia Zelaya", "Luis Fernando Oseguera"]) {
      const v = await saveVendedor({ nombre, activo: true }, true)
      ok(v, `vendedor ${nombre}`)
      vendedorIds.push(v.data!.id!)
      suma("Vendedores")
    }
    for (const c of CLIENTES) {
      const zona = zonaIds[c.zona]
      const vend = c.zona === "Tegucigalpa" ? vendedorIds[1] : c.zona === "Juticalpa" ? vendedorIds[2] : vendedorIds[0]
      const r = await saveCliente({ nombre: c.nombre, rtn: c.rtn, telefono: c.telefono, correo: `compras@${c.nombre.split(" ")[0].toLowerCase()}.hn`, dias_credito: 30, zona_id: zona, vendedor_id: vend }, true)
      ok(r, `cliente ${c.nombre}`)
      clienteIds.push(r.data!.id!)
      clienteZona[r.data!.id!] = vend
      suma("Clientes")
    }
    for (const p of PROVEEDORES) {
      const r = await saveProveedor({ nombre: p.nombre, rtn: p.rtn, dias_credito: 30 }, true)
      ok(r, `proveedor ${p.nombre}`)
      provIds.push(r.data!.id!)
      suma("Proveedores")
    }
    const pol = await savePoliticaComision({ nombre: "Comisión general 3 % al cobro", vendedor_id: null, base: "venta", porcentaje: 3, categoria_id: null, linea_id: null, momento: "cobro", vigente_desde: "2026-01-01", vigente_hasta: null, activo: true })
    ok(pol, "política de comisión")
    suma("Políticas de comisión")
  })

  it("2. Tesorería: cuenta bancaria con saldo inicial y caja", async () => {
    if (reanudar) return
    const c = await saveCuenta({ nombre: "Banco Atlántida · Cta. corriente", tipo: "Banco", porcentaje_comision: 0, activo: true }, true)
    ok(c, "cuenta")
    cuentaId = c.data!.id!
    const c2 = await saveCuenta({ nombre: "BAC · POS tarjetas", tipo: "Link_Pago", porcentaje_comision: 3.5, activo: true }, true)
    ok(c2, "cuenta POS")
    suma("Cuentas bancarias", 2)
    const ap = await registrarMovimientoCuenta({ cuenta_id: cuentaId, tipo: "Ingreso", monto: 450000, concepto: "Saldo inicial de apertura", fecha: ts("2026-07-01", 8), referencia: "APERTURA" })
    ok(ap, "saldo inicial")
    const s = await getSesionAbierta()
    if (!s.data?.id) ok(await abrirSesion(3000), "caja")
    ids.cuenta = cuentaId
    ids.cuenta_pos = c2.data!.id!
  })

  it("3. Categorías y catálogo de productos", async () => {
    if (reanudar) return
    const catId: Record<string, number> = {}
    for (const nombre of CATEGORIAS) {
      const c = await createCategoria(nombre)
      ok(c, `categoría ${nombre}`)
      catId[nombre] = c.data!.id!
      suma("Categorías")
    }
    for (const p of PRODUCTOS) {
      const r = await saveProducto({ nombre: p.nombre, codigo_barras: p.codigo, precio_venta_sugerido: p.precio, categoria_id: catId[p.categoria] }, true)
      ok(r, `producto ${p.nombre}`)
      prodId[p.codigo] = r.data!.id!
      prodPrecio[p.codigo] = p.precio
      stock[p.codigo] = 0
      suma("Productos")
    }
    for (const f of FABRICADOS) {
      const r = await saveProducto({ nombre: f.nombre, codigo_barras: f.codigo, precio_venta_sugerido: f.precio, categoria_id: catId["Impresión y artes gráficas"] }, true)
      ok(r, `producto ${f.nombre}`)
      prodId[f.codigo] = r.data!.id!
      prodPrecio[f.codigo] = f.precio
      stock[f.codigo] = 0
      suma("Productos")
    }
  })

  it("4. Órdenes de compra con recepción (entrada de inventario)", async () => {
    if (reanudar) return
    const porProveedor: Record<number, ProdDemo[]> = { 0: [], 1: [], 2: [], 3: [] }
    for (const p of PRODUCTOS) {
      const idx = p.categoria === "Papelería" ? 0 : p.categoria === "Tecnología" ? 1 : p.categoria === "Mobiliario de oficina" ? 2 : 3
      porProveedor[idx].push(p)
    }
    const fechas = ["2026-07-02", "2026-07-03", "2026-07-06", "2026-07-08"]
    for (const [idxStr, items] of Object.entries(porProveedor)) {
      const idx = Number(idxStr)
      if (items.length === 0) continue
      const total = r2(items.reduce((a, p) => a + p.costo * p.compra, 0))
      const oc = await createCompra(
        { proveedor_id: provIds[idx], fecha_orden: ts(fechas[idx], 9), fecha_tentativa: fechas[idx], moneda: "LPS", tasa_cambio: 1, costos_importacion: 0, impuestos_compra: 0, otros_costos: 0, total_compra_local: 0, subtotal: total, total, estado: "Pendiente" },
        items.map((p) => ({ producto_id: prodId[p.codigo], cantidad: p.compra, costo_unitario_moneda_origen: p.costo })),
      )
      ok(oc, `OC proveedor ${idx}`)
      suma("Órdenes de compra")
      const { data: det } = await getCliente().from("compras_detalle").select("id, producto_id, cantidad").eq("compra_id", oc.data!.id!)
      const rec = await procesarRecepcion({
        compraId: oc.data!.id!, costos_importacion: 0, impuestos_compra: 0, otros_costos: 0, tasa_cambio: 1, almacen_id: almacenId, localizacion_id: locId,
        numero_factura_proveedor: `000-001-01-${String(4500 + idx * 37).padStart(8, "0")}`,
        detalles: ((det || []) as { id: number; producto_id: number; cantidad: number }[]).map((d) => {
          const p = items.find((x) => prodId[x.codigo] === d.producto_id)!
          return { detalle_id: d.id, producto_id: d.producto_id, cantidad_recibida: Number(d.cantidad), costo_final_local: p.costo }
        }),
        pago: idx % 2 === 0 ? { metodo: "Credito", proveedor_id: provIds[idx], dias_credito: 30 } : { metodo: "Banco", cuenta_id: cuentaId, proveedor_id: provIds[idx], referencia: `TRF-${7000 + idx}` },
      })
      ok(rec, `recepción OC ${oc.data!.id}`)
      for (const p of items) {
        stock[p.codigo] += p.compra
        prodCosto[p.codigo] = p.costo
      }
    }
  })

  it("5. Materiales, recetas y producción de artículos impresos", async () => {
    if (reanudar) return
    const mats = [
      { clave: "papel_quimico", nombre: "Papel químico original/copia (hoja)", unidad: "hoja", cantidad: 30000, costo: 0.35 },
      { clave: "carton", nombre: "Cartón base para talonario", unidad: "unidad", cantidad: 300, costo: 3 },
      { clave: "cartulina", nombre: "Cartulina opalina (pliego)", unidad: "pliego", cantidad: 2500, costo: 4 },
      { clave: "tinta", nombre: "Tinta de impresión CMYK (ml)", unidad: "ml", cantidad: 5000, costo: 0.6 },
    ]
    const matId: Record<string, number> = {}
    for (const m of mats) {
      const { data, error } = await getCliente().from("materiales").insert({ nombre: m.nombre, unidad_medida: m.unidad, razon_social_id: tenant, usuario: "Demo" }).select("id").single()
      if (error) throw new Error(error.message)
      matId[m.clave] = (data as { id: number }).id
      suma("Materiales")
    }
    const cm = await createCompraMaterial({ proveedor_id: provIds[3], moneda: "LPS", tasa_cambio: 1, costos_importacion: 0, impuestos_compra: 0, otros_costos: 0, forma_pago: "Contado", lineas: mats.map((m) => ({ material_id: matId[m.clave], cantidad: m.cantidad, costo_unitario_moneda_origen: m.costo })) })
    ok(cm, "compra de materiales")
    ok(await recibirCompraMaterial(cm.data!.id, almacenId, locId), "recepción de materiales")
    suma("Compras de materiales")

    const recetas: Record<string, { lineas: { material_id: number; consumo_por_unidad: number; costo_promedio: number }[]; mo: number }> = {
      "IMP-001": { lineas: [{ material_id: matId.papel_quimico, consumo_por_unidad: 100, costo_promedio: 0.35 }, { material_id: matId.carton, consumo_por_unidad: 1, costo_promedio: 3 }, { material_id: matId.tinta, consumo_por_unidad: 5, costo_promedio: 0.6 }], mo: 0 },
      "IMP-002": { lineas: [{ material_id: matId.cartulina, consumo_por_unidad: 25, costo_promedio: 4 }, { material_id: matId.tinta, consumo_por_unidad: 20, costo_promedio: 0.6 }], mo: 0 },
    }
    for (const f of FABRICADOS) {
      ok(await setProductoFabricado(prodId[f.codigo], true), "fabricado")
      ok(await upsertReceta({ producto_id: prodId[f.codigo], estandar_unidades_por_minuto: 0.4, costo_energia: 0, costo_mano_obra: recetas[f.codigo].mo, costo_overhead: 0, lineas: recetas[f.codigo].lineas }), `receta ${f.codigo}`)
      suma("Recetas")
      // Dos órdenes por producto (julio y agosto).
      for (const [i, fecha] of ["2026-07-10", "2026-08-12"].entries()) {
        const cant = Math.round(f.cantidad / 2)
        const o = await createOrden({ producto_id: prodId[f.codigo], cantidad_objetivo: cant, fecha_objetivo: fecha, notas: `Lote ${i + 1} ${f.nombre}` })
        ok(o, "orden")
        suma("Órdenes de producción")
        const defect = entre(0, 3)
        const c = await createCorrida({ orden_id: o.data!.id, producto_id: prodId[f.codigo], operador: "Mario Roberto Aguilar", unidades_buenas: cant - defect, unidades_defectuosas: defect, tiempo_planificado_minutos: Math.round(cant / 0.4) })
        ok(c, "corrida")
        ok(await ejecutarCorrida(c.data!.id), "ejecutar corrida")
        ok(await recibirCorrida(c.data!.id, almacenId, locId), "recibir corrida")
        await setEstadoOrden(o.data!.id, "Cerrada")
        suma("Corridas de producción")
        stock[f.codigo] += cant - defect
      }
      const { data: p } = await getCliente().from("productos").select("costo_promedio").eq("id", prodId[f.codigo]).single()
      prodCosto[f.codigo] = Number((p as { costo_promedio: number }).costo_promedio)
    }
  })

  it("6. Ventas de julio a septiembre (banco, tarjeta, crédito y efectivo)", async () => {
    const codigos = [...PRODUCTOS.map((p) => p.codigo), ...FABRICADOS.map((f) => f.codigo)]
    const dias: string[] = []
    for (let d = "2026-07-06"; d <= sumarDias(HOY, -1); d = sumarDias(d, 1)) if (esHabil(d)) dias.push(d)
    const nVentas = 48
    const { count: previas } = await getCliente().from("ventas_encabezado").select("id", { count: "exact", head: true }).in("cliente_id", clienteIds)
    conteo["Ventas"] = previas || 0
    for (let i = previas || 0; i < nVentas; i++) {
      const fecha = dias[Math.floor((i / nVentas) * dias.length)]
      const cliente = elegir(clienteIds)
      const nLineas = entre(1, 4)
      const usados = new Set<string>()
      const detalles: { producto_id: number; cantidad: number; precio_unitario: number; costo_promedio_momento: number; utilidad_linea: number }[] = []
      for (let l = 0; l < nLineas; l++) {
        const cod = elegir(codigos.filter((c) => !usados.has(c) && stock[c] > 2))
        if (!cod) break
        usados.add(cod)
        const maxQ = prodPrecio[cod] > 1000 ? 2 : prodPrecio[cod] > 300 ? 5 : 15
        const cant = Math.min(stock[cod] - 1, entre(1, maxQ))
        if (cant <= 0) continue
        const precio = prodPrecio[cod]
        const costo = prodCosto[cod]
        detalles.push({ producto_id: prodId[cod], cantidad: cant, precio_unitario: precio, costo_promedio_momento: costo, utilidad_linea: r2((precio - costo) * cant) })
        stock[cod] -= cant
      }
      if (detalles.length === 0) continue
      const descuento = rnd() < 0.2 ? 5 : 0
      const bruto = r2(detalles.reduce((a, d) => a + d.cantidad * d.precio_unitario, 0))
      const baseImponible = r2(bruto * (1 - descuento / 100))
      const isv = r2(baseImponible * 0.15)
      const total = r2(baseImponible + isv)
      const reciente = fecha >= sumarDias(HOY, -4)
      const tipo = reciente && rnd() < 0.6 ? "Efectivo" : elegir(["Banco", "Banco", "Tarjeta", "Credito", "Credito"])
      const pagos =
        tipo === "Efectivo" ? [{ metodo_pago: "Efectivo" as const, monto_bruto: total }]
        : tipo === "Banco" ? [{ metodo_pago: "Banco" as const, cuenta_id: cuentaId, monto_bruto: total, porcentaje_comision: 0 }]
        : tipo === "Tarjeta" ? [{ metodo_pago: "Link_Pago" as const, cuenta_id: ids.cuenta_pos, monto_bruto: total, porcentaje_comision: 3.5 }]
        : []
      const v = await crearVenta({
        encabezado: {
          numero_factura: "", cliente_id: cliente, almacen_id: almacenId, aplica_impuesto: true, porcentaje_impuesto: 15, descuento,
          subtotal: bruto, impuesto_total: isv, total_venta: total, estado_pago: pagos.length ? "Pagado" : "Pendiente", valorpago: pagos.length ? total : 0,
          vendedor_id: clienteZona[cliente], fecha_venta: ts(fecha, entre(8, 17), entre(0, 59)),
        },
        detalles,
        almacen_id: almacenId,
        localizacion_id: locId,
        pagos_detalle: pagos,
      })
      ok(v, `venta ${i + 1}`)
      suma("Ventas")
      suma("Líneas de venta", detalles.length)
      // Kardex con la fecha de la venta (la app lo sella con la hora de registro).
      await getCliente().from("transacciones_inventario").update({ fecha: ts(fecha, 12) }).eq("referencia_id", v.data!.id!).eq("tipo_movimiento", "Salida Venta")
      if (!pagos.length) ventasCredito.push({ id: v.data!.id!, total, fecha })
    }
    expect(conteo["Ventas"]).toBeGreaterThan(40)
    const { data: pend } = await getCliente().from("ventas_encabezado").select("id, total_venta, fecha_venta, valorpago").in("cliente_id", clienteIds).eq("estado_pago", "Pendiente")
    ventasCredito.length = 0
    for (const v of (pend || []) as { id: number; total_venta: number; fecha_venta: string }[]) ventasCredito.push({ id: v.id, total: Number(v.total_venta), fecha: v.fecha_venta.slice(0, 10) })
  })

  it("7. Abonos de clientes (recibos de cobro) a ventas a crédito", async () => {
    const { count: recibos } = await getCliente().from("pagos_ventas").select("id", { count: "exact", head: true }).in("venta_id", ventasCredito.map((v) => v.id).concat([-1]))
    if ((recibos || 0) > 0) return
    const pagar = ventasCredito.filter((v) => v.fecha < "2026-09-01")
    for (const [i, v] of pagar.entries()) {
      const monto = i % 3 === 0 ? r2(v.total / 2) : v.total
      const r = await registrarPago({ venta_id: v.id, monto, metodo_pago: "Transferencia" }, { cuenta_id: cuentaId })
      ok(r, `abono venta ${v.id}`)
      suma("Recibos de cobro")
    }
  })

  it("8. Gastos operativos de tres meses", async () => {
    async function concepto(nombre: string, cat: CategoriaMacro): Promise<number> {
      const { data } = await getConceptosGasto()
      const ex = (data || []).find((c) => c.nombre === nombre)
      if (ex?.id) return ex.id
      const cr = await createConceptoGasto({ nombre, categoria_macro: cat })
      ok(cr, nombre)
      return cr.data!.id!
    }
    const plan: { nombre: string; cat: CategoriaMacro; monto: number; dia: number; credito?: boolean }[] = [
      { nombre: "Alquiler de local", cat: "Arriendo", monto: 18000, dia: 5, credito: true },
      { nombre: "Energía eléctrica ENEE", cat: "Servicios", monto: 4200, dia: 12 },
      { nombre: "Internet y telefonía", cat: "Servicios", monto: 1850, dia: 15 },
      { nombre: "Publicidad en redes sociales", cat: "Publicidad", monto: 3500, dia: 20 },
      { nombre: "Mantenimiento de equipo de impresión", cat: "Mantenimiento", monto: 2600, dia: 25 },
      { nombre: "Combustible reparto", cat: "Otros", monto: 2900, dia: 27 },
    ]
    const { data: previos } = await getCliente().from("gastos").select("descripcion").like("descripcion", "Alquiler de local 2026-%")
    if ((previos || []).length > 0) return
    for (const mes of ["2026-07", "2026-08", "2026-09"]) {
      for (const g of plan) {
        if (mes === "2026-09" && g.dia > Number(HOY.slice(8, 10))) continue
        const monto = r2(g.monto * (0.92 + rnd() * 0.16))
        const fecha = `${mes}-${String(g.dia).padStart(2, "0")}`
        const cId = await concepto(g.nombre, g.cat)
        const pendiente = g.credito && mes === "2026-09"
        const r = await createGasto({
          concepto_id: cId, fecha_gasto: fecha, monto, metodo_pago: "Transferencia", descripcion: `${g.nombre} ${mes}`,
          fecha_vencimiento: pendiente ? sumarDias(fecha, 30) : null, pagar_ahora: !pendiente, pago_metodo: "Banco", pago_cuenta_id: cuentaId,
        })
        ok(r, `gasto ${g.nombre} ${mes}`)
        suma("Gastos")
      }
    }
  })

  it("9. Empleados, expediente básico y vacaciones", async () => {
    if (await existe("empleados", "codigo", "E-001")) {
      const { data: es } = await getCliente().from("empleados").select("id, codigo").in("codigo", EMPLEADOS.map((e) => e.codigo!))
      for (const e of (es || []) as { id: number; codigo: string }[]) empleadoIds[e.codigo] = e.id
      return
    }
    for (const e of EMPLEADOS) {
      const r = await saveEmpleado({
        ...e, tipo_contrato: "Permanente", forma_pago: "Transferencia", banco: "Banco Atlántida", cuenta_bancaria: `2${String(entre(10000000, 99999999))}`,
        telefono: `9${entre(100, 999)}-${entre(1000, 9999)}`, correo: `${e.nombre.split(" ")[0].toLowerCase()}.${e.nombre.split(" ")[2]?.toLowerCase() || "om"}@officemart.hn`,
        ihss_afiliacion: `IHSS-${entre(100000, 999999)}`, rap_afiliacion: `RAP-${entre(100000, 999999)}`, aplica_ihss: true, aplica_rap: true, aplica_isr: true, estado: "Activo",
      })
      ok(r, `empleado ${e.nombre}`)
      empleadoIds[e.codigo!] = r.data!.id!
      suma("Empleados")
    }
    ok(await registrarVacaciones({ empleado_id: empleadoIds["E-002"], modo: "gozadas", dias: 5, fecha: "2026-07-20", descripcion: "Vacaciones de medio año" }), "vacaciones")
    ok(await registrarVacaciones({ empleado_id: empleadoIds["E-009"], modo: "gozadas", dias: 3, fecha: "2026-08-10" }), "vacaciones")
    ok(await registrarVacaciones({ empleado_id: empleadoIds["E-001"], modo: "pagadas", dias: 4, fecha: "2026-08-28", descripcion: "Liquidación parcial de vacaciones" }), "liquidación")
    suma("Registros de vacaciones", 3)
  })

  it("10. Asistencia de las últimas dos semanas", async () => {
    if (await existe("rrhh_marcaciones", "empleado_id", empleadoIds["E-001"])) return
    const desde = sumarDias(HOY, -14)
    for (let d = desde; d < HOY; d = sumarDias(d, 1)) {
      if (!esHabil(d)) continue
      for (const [codigo, id] of Object.entries(empleadoIds)) {
        if (rnd() < 0.04) continue // alguna ausencia
        const ent = `${String(entre(7, 8)).padStart(2, "0")}:${String(entre(0, 59)).padStart(2, "0")}`
        const sal = codigo === "E-001" ? "18:15" : `${String(entre(16, 17)).padStart(2, "0")}:${String(entre(0, 59)).padStart(2, "0")}`
        ok(await saveMarcacion({ empleado_id: id, fecha: d, entrada: ent, salida: sal, origen: "import" }), "marcación")
        suma("Marcaciones de asistencia")
      }
    }
  })

  it("11. Novedades y nóminas (julio y agosto mensual; septiembre quincenal)", async () => {
    const { data: nomPrev } = await getCliente().from("rrhh_nominas").select("id").eq("tipo", "Quincenal").eq("periodo_desde", "2026-07-01").neq("estado", "Anulada").limit(1)
    if ((nomPrev || []).length > 0) return
    const nov = async (codigo: string, tipo: TipoNovedad, fecha: string, valor: number, desc: string) => {
      const esMonto = !["Horas extra diurna", "Horas extra nocturna", "Horas extra mixta", "Ausencia", "Permiso sin goce", "Incapacidad", "Vacaciones pagadas"].includes(tipo)
      const def = { gravable: !["Aguinaldo", "Deduccion", "Anticipo", "Prestamo"].includes(tipo), cotizable: !["Aguinaldo", "Otro ingreso", "Deduccion", "Anticipo", "Prestamo"].includes(tipo) }
      ok(await saveNovedad({ empleado_id: empleadoIds[codigo], tipo, fecha, cantidad: esMonto ? null : valor, monto: esMonto ? valor : null, ...def, descripcion: desc }), `novedad ${tipo}`)
      suma("Novedades de nómina")
    }
    await nov("E-003", "Comision", "2026-07-31", 3850, "Comisión de ventas julio")
    await nov("E-004", "Comision", "2026-07-31", 4120, "Comisión de ventas julio")
    await nov("E-005", "Comision", "2026-07-31", 2680, "Comisión de ventas julio")
    await nov("E-003", "Comision", "2026-08-31", 4410, "Comisión de ventas agosto")
    await nov("E-004", "Comision", "2026-08-31", 3960, "Comisión de ventas agosto")
    await nov("E-005", "Comision", "2026-08-31", 3150, "Comisión de ventas agosto")
    await nov("E-002", "Bono", "2026-08-31", 1500, "Bono por cierre fiscal")
    await nov("E-005", "Anticipo", "2026-08-15", 2000, "Anticipo de salario")
    await nov("E-007", "Horas extra diurna", "2026-09-10", 6, "Pedido urgente de talonarios")
    await nov("E-008", "Horas extra nocturna", "2026-09-18", 4, "Diseño de campaña")
    await nov("E-010", "Ausencia", "2026-09-22", 1, "Ausencia injustificada")
    await nov("E-006", "Horas extra diurna", "2026-09-24", 3, "Inventario de fin de mes")

    const corridas: { tipo: "Mensual" | "Quincenal"; desde: string; hasta: string; pagar: boolean }[] = [
      { tipo: "Mensual", desde: "2026-07-01", hasta: "2026-07-31", pagar: true },
      { tipo: "Quincenal", desde: "2026-07-01", hasta: "2026-07-15", pagar: true },
      { tipo: "Quincenal", desde: "2026-07-16", hasta: "2026-07-31", pagar: true },
      { tipo: "Mensual", desde: "2026-08-01", hasta: "2026-08-31", pagar: true },
      { tipo: "Quincenal", desde: "2026-08-01", hasta: "2026-08-15", pagar: true },
      { tipo: "Quincenal", desde: "2026-08-16", hasta: "2026-08-31", pagar: true },
      { tipo: "Quincenal", desde: "2026-09-01", hasta: "2026-09-15", pagar: true },
      { tipo: "Quincenal", desde: "2026-09-16", hasta: "2026-09-30", pagar: false },
    ]
    for (const c of corridas) {
      const g = await generarNomina({ tipo: c.tipo, desde: c.desde, hasta: c.hasta, fecha_pago: c.hasta, notas: `Nómina ${c.tipo.toLowerCase()} ${c.desde} a ${c.hasta}` })
      ok(g, `nómina ${c.desde}`)
      suma("Nóminas")
      if (c.pagar) {
        ok(await aprobarNomina(g.data!.id), "aprobar")
        ok(await pagarNomina(g.data!.id, { metodo: "Banco", cuenta_id: cuentaId, fecha: c.hasta > HOY ? HOY : c.hasta }), "pagar")
      }
    }
  })

  it("12. Cotizaciones en distintos estados", async () => {
    const { count: cotPrev } = await getCliente().from("cotizaciones_encabezado").select("id", { count: "exact", head: true }).like("condiciones", "Precios en lempiras. Entrega en 5 días%")
    if ((cotPrev || 0) > 0) return
    const estados: ("Borrador" | "Enviada" | "Aprobada" | "Rechazada")[] = ["Enviada", "Enviada", "Aprobada", "Aprobada", "Borrador", "Rechazada", "Enviada", "Aprobada"]
    const codigos = [...PRODUCTOS.map((p) => p.codigo), ...FABRICADOS.map((f) => f.codigo)]
    for (const [i, estado] of estados.entries()) {
      const cliente = clienteIds[(i * 3) % clienteIds.length]
      const lineas = Array.from({ length: entre(2, 4) }, () => {
        const cod = elegir(codigos)
        return { producto_id: prodId[cod], descripcion: [...PRODUCTOS, ...FABRICADOS].find((p) => p.codigo === cod)!.nombre, cantidad: entre(5, 40), precio_unitario: prodPrecio[cod], descuento_linea: rnd() < 0.3 ? 5 : 0 }
      })
      const fecha = sumarDias(HOY, -entre(1, 20))
      const cot = await crearCotizacion({ cliente_id: cliente, cliente_nombre: CLIENTES[(i * 3) % CLIENTES.length].nombre, vendedor_id: clienteZona[cliente], fecha, vigencia_hasta: sumarDias(fecha, 15 + (i % 2) * 15), aplica_impuesto: true, descuento: 0, condiciones: "Precios en lempiras. Entrega en 5 días hábiles. Pago a 30 días.", lineas })
      ok(cot, `cotización ${i + 1}`)
      if (estado !== "Borrador") ok(await cambiarEstadoCotizacion(cot.data!.id, "Enviada"), "enviar")
      if (estado === "Aprobada") ok(await cambiarEstadoCotizacion(cot.data!.id, "Aprobada"), "aprobar")
      if (estado === "Rechazada") ok(await cambiarEstadoCotizacion(cot.data!.id, "Rechazada", { motivo: "Eligió otro proveedor por precio" }), "rechazar")
      suma("Cotizaciones")
    }
  })

  it("13. CRM: contactos, oportunidades en el pipeline y actividades", async () => {
    if (await existe("crm_oportunidades", "titulo", "Suministro anual de papelería")) return
    const etapas = await getEtapas()
    ok(etapas, "etapas")
    const et = etapas.data
    const contactos: number[] = []
    const nombres = ["Mariela Cáceres", "Roberto Funes", "Gabriela Sabillón", "Héctor Villeda", "Paola Andino", "Óscar Maradiaga"]
    for (const [i, n] of nombres.entries()) {
      const c = await saveContacto({ cliente_id: clienteIds[i], nombre: n, cargo: elegir(["Jefe de compras", "Gerente administrativo", "Asistente de compras"]), telefono: `9${entre(100, 999)}-${entre(1000, 9999)}`, correo: `${n.split(" ")[0].toLowerCase()}@cliente.hn`, cumpleanos: i === 0 ? `1985-${sumarDias(HOY, 2).slice(5)}` : null })
      ok(c, "contacto")
      contactos.push(c.data!.id!)
      suma("Contactos CRM")
    }
    const ops = [
      { titulo: "Suministro anual de papelería", valor: 185000, etapa: 3, cli: 0, origen: "Cliente existente" },
      { titulo: "Equipamiento de laboratorio de cómputo", valor: 96000, etapa: 2, cli: 7, origen: "Licitación" },
      { titulo: "Mobiliario para nueva sucursal", valor: 142000, etapa: 4, cli: 8, origen: "Referido" },
      { titulo: "Talonarios fiscales 2027", valor: 38000, etapa: 1, cli: 3, origen: "Llamada en frío" },
      { titulo: "Kits escolares para becados", valor: 54000, etapa: 2, cli: 1, origen: "Sitio web" },
      { titulo: "Contrato de tóner y mantenimiento", valor: 72000, etapa: 3, cli: 4, origen: "Cliente existente" },
      { titulo: "Material POP para campaña navideña", valor: 29500, etapa: 0, cli: 12, origen: "Redes sociales" },
      { titulo: "Insumos de limpieza trimestral", valor: 21000, etapa: 1, cli: 6, origen: "Referido" },
      { titulo: "Papelería para elecciones internas", valor: 45000, etapa: 4, cli: 5, origen: "Licitación", cierre: "Ganada" as const },
      { titulo: "Sillas ergonómicas para call center", valor: 64000, etapa: 3, cli: 2, origen: "Feria / evento", cierre: "Perdida" as const },
    ]
    for (const [i, o] of ops.entries()) {
      const r = await crearOportunidad({ titulo: o.titulo, cliente_id: clienteIds[o.cli], contacto_id: contactos[i % contactos.length], vendedor_id: clienteZona[clienteIds[o.cli]], etapa_id: et[Math.min(o.etapa, et.length - 1)].id!, valor_estimado: o.valor, fecha_cierre_esperada: sumarDias(HOY, entre(-5, 45)), origen: o.origen })
      ok(r, `oportunidad ${o.titulo}`)
      suma("Oportunidades CRM")
      if (o.cierre) ok(await cerrarOportunidad(r.data!.id, o.cierre, o.cierre === "Perdida" ? "Precio" : null), "cerrar")
      const tipos: TipoActividad[] = ["Llamada", "Visita", "Reunion", "Correo", "Tarea"]
      for (let k = 0; k < (i < 6 ? 2 : 1); k++) {
        const fecha = sumarDias(HOY, k === 0 ? -entre(1, 10) : entre(0, 6))
        const a = await crearActividad({ oportunidad_id: r.data!.id, cliente_id: clienteIds[o.cli], vendedor_id: clienteZona[clienteIds[o.cli]], tipo: elegir(tipos), asunto: k === 0 ? `Seguimiento: ${o.titulo}` : `Presentar propuesta: ${o.titulo}`, fecha: ts(fecha, entre(8, 16)) })
        ok(a, "actividad")
        suma("Actividades CRM")
      }
    }
  })

  it("14. Ventas institucionales con reabastecimiento mensual", async () => {
    const { data: prev } = await getCliente().from("compras_encabezado").select("id").eq("numero_factura", "LIC-2026-07").limit(1)
    if ((prev || []).length > 0) return
    // Compra mensual de reabastecimiento (cantidades por producto).
    const plan: Record<string, number> = {
      "PAP-001": 750, "PAP-002": 400, "PAP-003": 300, "PAP-004": 150, "PAP-005": 75, "TEC-001": 150, "TEC-002": 150, "TEC-003": 125,
      "TEC-004": 200, "TEC-005": 40, "MOB-001": 60, "MOB-002": 20, "MOB-003": 30, "LIM-001": 200, "LIM-002": 125, "LIM-003": 150,
    }
    const institucionales = ["Alcaldía Municipal de La Lima", "Universidad Tecnológica del Norte", "Banco Comunal Esperanza", "Grupo Industrial del Valle de Sula", "Constructora Honducasa", "Instituto Técnico Honduras", "Colegio Bilingüe Los Pinares", "Hotel Plaza Copán"]
    const { data: cls } = await getCliente().from("clientes").select("id, nombre, vendedor_id").in("nombre", institucionales)
    const clientesInst = (cls || []) as { id: number; nombre: string; vendedor_id: number }[]
    const meses = [
      { mes: "2026-07", oc: "2026-07-14", ventas: ["2026-07-16", "2026-07-20", "2026-07-23", "2026-07-27", "2026-07-29", "2026-07-31"], pago: "Banco" as const },
      { mes: "2026-08", oc: "2026-08-04", ventas: ["2026-08-06", "2026-08-11", "2026-08-17", "2026-08-21", "2026-08-26", "2026-08-28"], pago: "Banco" as const },
      { mes: "2026-09", oc: "2026-09-02", ventas: ["2026-09-04", "2026-09-09", "2026-09-14", "2026-09-18", "2026-09-23", "2026-09-25"], pago: "Credito" as const },
    ]
    const prov = (cod: string) => (cod.startsWith("PAP") ? provIds[0] : cod.startsWith("TEC") ? provIds[1] : cod.startsWith("MOB") ? provIds[2] : provIds[3])
    for (const [mi, m] of meses.entries()) {
      // 1) Una OC por proveedor, recibida el mismo día.
      const porProv = new Map<number, string[]>()
      for (const cod of Object.keys(plan)) porProv.set(prov(cod), [...(porProv.get(prov(cod)) || []), cod])
      for (const [provId, cods] of porProv) {
        const total = r2(cods.reduce((a, c) => a + prodCosto[c] * plan[c], 0))
        const oc = await createCompra(
          { proveedor_id: provId, numero_factura: provId === provIds[0] ? `LIC-${m.mes}` : null, fecha_orden: ts(m.oc, 9), fecha_tentativa: m.oc, moneda: "LPS", tasa_cambio: 1, costos_importacion: 0, impuestos_compra: 0, otros_costos: 0, total_compra_local: 0, subtotal: total, total, estado: "Pendiente" },
          cods.map((c) => ({ producto_id: prodId[c], cantidad: plan[c], costo_unitario_moneda_origen: prodCosto[c] })),
        )
        ok(oc, "OC de reabastecimiento")
        suma("Órdenes de compra")
        const { data: det } = await getCliente().from("compras_detalle").select("id, producto_id, cantidad").eq("compra_id", oc.data!.id!)
        ok(await procesarRecepcion({
          compraId: oc.data!.id!, costos_importacion: 0, impuestos_compra: 0, otros_costos: 0, tasa_cambio: 1, almacen_id: almacenId, localizacion_id: locId,
          numero_factura_proveedor: `000-001-01-${String(6100 + mi * 10 + provIds.indexOf(provId)).padStart(8, "0")}`,
          detalles: ((det || []) as { id: number; producto_id: number; cantidad: number }[]).map((d) => {
            const cod = cods.find((c) => prodId[c] === d.producto_id)!
            return { detalle_id: d.id, producto_id: d.producto_id, cantidad_recibida: Number(d.cantidad), costo_final_local: prodCosto[cod] }
          }),
          pago: m.pago === "Banco" ? { metodo: "Banco", cuenta_id: cuentaId, proveedor_id: provId, referencia: `TRF-${m.mes}-${provId}` } : { metodo: "Credito", proveedor_id: provId, dias_credito: 30 },
        }), "recepción de reabastecimiento")
        for (const c of cods) stock[c] += plan[c]
      }
      // 2) Seis ventas institucionales: cada producto se reparte en dos pedidos.
      const lineas: { producto_id: number; cantidad: number; precio_unitario: number; costo_promedio_momento: number; utilidad_linea: number }[][] = m.ventas.map(() => [])
      for (const cod of Object.keys(plan)) {
        const vender = Math.min(stock[cod] - 2, Math.floor(plan[cod] * 0.88))
        if (vender <= 0) continue
        const a = entre(0, 5)
        let b = entre(0, 5)
        if (b === a) b = (a + 3) % 6
        const q1 = Math.ceil(vender * 0.55)
        for (const [idx, q] of [[a, q1], [b, vender - q1]] as [number, number][]) {
          if (q <= 0) continue
          const precio = r2(prodPrecio[cod] * 0.95) // precio institucional (−5 %)
          lineas[idx].push({ producto_id: prodId[cod], cantidad: q, precio_unitario: precio, costo_promedio_momento: prodCosto[cod], utilidad_linea: r2((precio - prodCosto[cod]) * q) })
        }
        stock[cod] -= vender
      }
      for (const [si, fecha] of m.ventas.entries()) {
        const det = lineas[si]
        if (det.length === 0) continue
        const cli = clientesInst[(mi * 6 + si) % clientesInst.length]
        const subtotal = r2(det.reduce((a, d) => a + d.cantidad * d.precio_unitario, 0))
        const isv = r2(subtotal * 0.15)
        const total = r2(subtotal + isv)
        const credito = si % 3 === 2
        const v = await crearVenta({
          encabezado: { numero_factura: "", cliente_id: cli.id, almacen_id: almacenId, aplica_impuesto: true, porcentaje_impuesto: 15, descuento: 0, subtotal, impuesto_total: isv, total_venta: total, estado_pago: credito ? "Pendiente" : "Pagado", valorpago: credito ? 0 : total, vendedor_id: cli.vendedor_id, fecha_venta: ts(fecha, 10, 30) },
          detalles: det, almacen_id: almacenId, localizacion_id: locId,
          pagos_detalle: credito ? [] : [{ metodo_pago: "Banco", cuenta_id: cuentaId, monto_bruto: total, porcentaje_comision: 0 }],
        })
        ok(v, `venta institucional ${fecha}`)
        suma("Ventas")
        suma("Líneas de venta", det.length)
        await getCliente().from("transacciones_inventario").update({ fecha: ts(fecha, 12) }).eq("referencia_id", v.data!.id!).eq("tipo_movimiento", "Salida Venta")
        // Crédito de julio y agosto ya cobrado (recibo); septiembre queda en CxC.
        if (credito && m.mes !== "2026-09") {
          ok(await registrarPago({ venta_id: v.data!.id!, monto: total, metodo_pago: "Transferencia" }, { cuenta_id: cuentaId }), "cobro institucional")
          suma("Recibos de cobro")
        }
      }
    }
  })

  it("14b. Nómina mensual de septiembre (complementaria)", async () => {
    const { data: prev } = await getCliente().from("rrhh_nominas").select("id, notas").eq("tipo", "Mensual").eq("periodo_desde", "2026-09-01").neq("estado", "Anulada")
    if (((prev || []) as { notas: string | null }[]).some((n) => (n.notas || "").includes("Complementaria"))) return
    const g = await generarNomina({ tipo: "Mensual", desde: "2026-09-01", hasta: "2026-09-30", fecha_pago: "2026-09-30", notas: "Nómina mensual septiembre" })
    ok(g, "nómina mensual septiembre")
    const { count } = await getCliente().from("rrhh_nominas_detalle").select("id", { count: "exact", head: true }).eq("nomina_id", g.data!.id)
    expect(count).toBe(5)
    ok(await aprobarNomina(g.data!.id), "aprobar")
    ok(await pagarNomina(g.data!.id, { metodo: "Banco", cuenta_id: cuentaId, fecha: HOY }), "pagar")
    suma("Nóminas")
  })

  it("15. Resumen de saldos", async () => {
    const cuentas = await getCuentas()
    const banco = cuentas.data.find((c) => c.id === cuentaId)
    expect(Number(banco?.saldo || 0)).toBeGreaterThan(0)
    const { data: stockBajo } = await getCliente().from("productos").select("nombre, stock_total").lt("stock_total", 10).gt("stock_total", -1)
    console.log("Saldo banco:", banco?.saldo, "· productos con stock < 10:", (stockBajo || []).length)
  })
})

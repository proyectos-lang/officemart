import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { ejecutarVigentes } from "@/lib/services/ventas-filtros"
import { adjuntarRelacion } from "@/lib/services/relaciones"

/**
 * Estado de cuenta de cliente (Fase 2.5). Sin tabla propia: se arma desde
 * ventas vigentes (débitos), abonos (`pagos_ventas`, con o sin recibo) y
 * devoluciones vigentes (créditos). Todo lo que calcula es puro
 * (`construirEstadoCuenta`, `calcularAntiguedad`) y se prueba en
 * tests/estado-cuenta.test.ts.
 */

export type TipoMovimientoEC = "Factura" | "Abono" | "Devolución"

export interface MovimientoEstadoCuenta {
  fecha: string
  tipo: TipoMovimientoEC
  /** Número visible: FC-0001, RC-0003, DEV-0002. */
  documento: string
  /** Detalle: factura a la que aplica, método, motivo… */
  referencia: string | null
  debito: number
  credito: number
  /** Saldo acumulado después de este movimiento. */
  saldo: number
  venta_id: number | null
}

export interface FacturaPendiente {
  venta_id: number
  numero_factura: string
  fecha: string
  total: number
  saldo: number
  dias: number
}

export interface Antiguedad {
  corriente: number
  d1_30: number
  d31_60: number
  d61_90: number
  mas90: number
  total: number
}

export interface EstadoCuenta {
  saldoInicial: number
  movimientos: MovimientoEstadoCuenta[]
  totalDebitos: number
  totalCreditos: number
  saldoFinal: number
  /** Facturas con saldo a la fecha (vigentes, todas las fechas). */
  pendientes: FacturaPendiente[]
  antiguedad: Antiguedad
}

// ---- Entradas crudas (lo que devuelven las consultas) ----

export interface VentaEC {
  id: number
  numero_factura: string
  fecha_venta: string
  total_venta: number
  valorpago: number
}
export interface AbonoEC {
  venta_id: number
  fecha_pago: string
  monto: number
  metodo_pago: string | null
  numero_recibo?: string | null
}
export interface DevolucionEC {
  venta_id: number
  fecha: string
  monto_total: number
  numero_devolucion: string | null
  motivo: string | null
}

// ==================== FUNCIONES PURAS ====================

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

function enRango(fechaISO: string, desde?: string | null, hasta?: string | null): "antes" | "dentro" | "despues" {
  const d = (fechaISO || "").slice(0, 10)
  if (desde && d < desde.slice(0, 10)) return "antes"
  if (hasta && d > hasta.slice(0, 10)) return "despues"
  return "dentro"
}

/** Días transcurridos entre dos fechas ISO (solo la parte de fecha). */
export function diasEntre(desdeISO: string, hastaISO: string): number {
  const a = new Date(`${desdeISO.slice(0, 10)}T00:00:00Z`).getTime()
  const b = new Date(`${hastaISO.slice(0, 10)}T00:00:00Z`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/** Antigüedad de saldos por factura (corriente = 0 días, luego tramos de 30). */
export function calcularAntiguedad(pendientes: FacturaPendiente[]): Antiguedad {
  const a: Antiguedad = { corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, mas90: 0, total: 0 }
  for (const p of pendientes) {
    if (p.saldo <= 0) continue
    if (p.dias <= 0) a.corriente += p.saldo
    else if (p.dias <= 30) a.d1_30 += p.saldo
    else if (p.dias <= 60) a.d31_60 += p.saldo
    else if (p.dias <= 90) a.d61_90 += p.saldo
    else a.mas90 += p.saldo
    a.total += p.saldo
  }
  return {
    corriente: r2(a.corriente),
    d1_30: r2(a.d1_30),
    d31_60: r2(a.d31_60),
    d61_90: r2(a.d61_90),
    mas90: r2(a.mas90),
    total: r2(a.total),
  }
}

/**
 * Arma el estado de cuenta: saldo inicial (movimientos antes de `desde`),
 * movimientos del período ordenados por fecha con saldo corrido, totales y
 * antigüedad de las facturas con saldo a `hoyISO`.
 */
export function construirEstadoCuenta(
  input: {
    ventas: VentaEC[]
    abonos: AbonoEC[]
    devoluciones: DevolucionEC[]
    desde?: string | null
    hasta?: string | null
    hoyISO: string
  }
): EstadoCuenta {
  const facturaNum = new Map<number, string>()
  for (const v of input.ventas) facturaNum.set(v.id, v.numero_factura)

  type Bruto = Omit<MovimientoEstadoCuenta, "saldo"> & { orden: number }
  const brutos: Bruto[] = []
  for (const v of input.ventas) {
    brutos.push({
      fecha: v.fecha_venta,
      tipo: "Factura",
      documento: v.numero_factura,
      referencia: null,
      debito: r2(v.total_venta),
      credito: 0,
      venta_id: v.id,
      orden: 0,
    })
  }
  for (const a of input.abonos) {
    brutos.push({
      fecha: a.fecha_pago,
      tipo: "Abono",
      documento: a.numero_recibo || "Abono",
      referencia: [facturaNum.get(a.venta_id) || `Venta #${a.venta_id}`, a.metodo_pago || null].filter(Boolean).join(" · "),
      debito: 0,
      credito: r2(a.monto),
      venta_id: a.venta_id,
      orden: 1,
    })
  }
  for (const d of input.devoluciones) {
    brutos.push({
      fecha: d.fecha,
      tipo: "Devolución",
      documento: d.numero_devolucion || "Devolución",
      referencia: [facturaNum.get(d.venta_id) || `Venta #${d.venta_id}`, d.motivo || null].filter(Boolean).join(" · "),
      debito: 0,
      credito: r2(d.monto_total),
      venta_id: d.venta_id,
      orden: 2,
    })
  }
  brutos.sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : x.orden - y.orden))

  let saldoInicial = 0
  let saldo = 0
  const movimientos: MovimientoEstadoCuenta[] = []
  let totalDebitos = 0
  let totalCreditos = 0
  for (const m of brutos) {
    const pos = enRango(m.fecha, input.desde, input.hasta)
    if (pos === "antes") {
      saldoInicial += m.debito - m.credito
      continue
    }
    if (pos === "despues") continue
    if (movimientos.length === 0) saldo = saldoInicial
    saldo += m.debito - m.credito
    totalDebitos += m.debito
    totalCreditos += m.credito
    const { orden: _o, ...resto } = m
    movimientos.push({ ...resto, saldo: r2(saldo) })
  }
  const saldoFinal = movimientos.length > 0 ? movimientos[movimientos.length - 1].saldo : r2(saldoInicial)

  // Pendientes: saldo por factura = total - valorpago (fuente de verdad de la
  // venta), a hoy, sin importar el rango de fechas.
  const pendientes: FacturaPendiente[] = input.ventas
    .map((v) => ({
      venta_id: v.id,
      numero_factura: v.numero_factura,
      fecha: v.fecha_venta,
      total: r2(v.total_venta),
      saldo: r2(Math.max(0, Number(v.total_venta || 0) - Number(v.valorpago || 0))),
      dias: diasEntre(v.fecha_venta, input.hoyISO),
    }))
    .filter((p) => p.saldo > 0.005)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1))

  return {
    saldoInicial: r2(saldoInicial),
    movimientos,
    totalDebitos: r2(totalDebitos),
    totalCreditos: r2(totalCreditos),
    saldoFinal,
    pendientes,
    antiguedad: calcularAntiguedad(pendientes),
  }
}

// ==================== CONSULTA ====================

const CHUNK = 200

export async function getEstadoCuentaCliente(
  clienteId: number,
  opts: { desde?: string | null; hasta?: string | null; hoyISO: string }
): Promise<{ data: EstadoCuenta | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: null }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  try {
    // 1) Ventas vigentes del cliente (todas: el saldo inicial necesita historia).
    const { data: ventasRaw, error: vErr } = await ejecutarVigentes<Record<string, unknown>[] | null>((filtrar) => {
      let q = supabase
        .from("ventas_encabezado")
        .select("id, numero_factura, fecha_venta, total_venta, valorpago")
        .eq("cliente_id", clienteId)
        .order("fecha_venta", { ascending: true })
      if (filtrar) q = q.is("anulada_at", null)
      return q
    })
    if (vErr) return { data: null, error: (vErr as { message?: string }).message || String(vErr) }
    const ventas: VentaEC[] = (ventasRaw || []).map((v) => ({
      id: Number(v.id),
      numero_factura: String(v.numero_factura ?? ""),
      fecha_venta: String(v.fecha_venta ?? ""),
      total_venta: Number(v.total_venta ?? 0),
      valorpago: Number(v.valorpago ?? 0),
    }))
    const ids = ventas.map((v) => v.id)

    const abonos: AbonoEC[] = []
    const devoluciones: DevolucionEC[] = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const lote = ids.slice(i, i + CHUNK)
      // 2) Abonos (con número de recibo si lo tienen; reintento sin la relación).
      let pagosData: Record<string, unknown>[] = []
      const conRecibo = await supabase
        .from("pagos_ventas")
        .select("venta_id, fecha_pago, monto, metodo_pago, recibo_id")
        .in("venta_id", lote)
      if (!conRecibo.error) {
        // pagos_ventas.recibo_id no tiene llave foránea: se une por id.
        pagosData = await adjuntarRelacion(supabase, (conRecibo.data || []) as Record<string, unknown>[], { campo: "recibo_id", tabla: "recibos_cobro", columnas: "numero_recibo", como: "recibos_cobro" })
      } else {
        const simple = await supabase.from("pagos_ventas").select("venta_id, fecha_pago, monto, metodo_pago").in("venta_id", lote)
        pagosData = (simple.data || []) as Record<string, unknown>[]
      }
      for (const p of pagosData) {
        const rc = Array.isArray(p.recibos_cobro) ? p.recibos_cobro[0] : p.recibos_cobro
        abonos.push({
          venta_id: Number(p.venta_id),
          fecha_pago: String(p.fecha_pago ?? ""),
          monto: Number(p.monto ?? 0),
          metodo_pago: (p.metodo_pago as string) ?? null,
          numero_recibo: (rc as { numero_recibo?: string } | null)?.numero_recibo ?? null,
        })
      }
      // 3) Devoluciones vigentes (columna anulada_at del officemart-003; reintento sin ella).
      let devRes = await supabase
        .from("devoluciones_encabezado")
        .select("venta_id, fecha, monto_total, numero_devolucion, motivo")
        .in("venta_id", lote)
        .is("anulada_at", null)
      if (devRes.error && /anulada_at/i.test(devRes.error.message || "")) {
        devRes = await supabase
          .from("devoluciones_encabezado")
          .select("venta_id, fecha, monto_total, numero_devolucion, motivo")
          .in("venta_id", lote)
      }
      for (const d of (devRes.data || []) as Record<string, unknown>[]) {
        devoluciones.push({
          venta_id: Number(d.venta_id),
          fecha: String(d.fecha ?? ""),
          monto_total: Number(d.monto_total ?? 0),
          numero_devolucion: (d.numero_devolucion as string) ?? null,
          motivo: (d.motivo as string) ?? null,
        })
      }
    }

    return {
      data: construirEstadoCuenta({ ventas, abonos, devoluciones, desde: opts.desde, hasta: opts.hasta, hoyISO: opts.hoyISO }),
      error: null,
    }
  } catch (err) {
    console.error("[estado-cuenta] get:", err)
    return { data: null, error: "Error de conexión" }
  }
}

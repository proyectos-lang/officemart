"use client"

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp } from "@/lib/services/tenant-stamp"
import { ejecutarVigentes } from "@/lib/services/ventas-filtros"

/** Parte un arreglo en grupos de `size` (para no exceder el largo de URL en `.in()`). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
const IN_CHUNK = 200

/**
 * Resumen de pagos del periodo, derivado de la tabla `ventas_pagos_detalle`
 * (migracion 011). Sirve como fuente unica para:
 *   - KPIs de Venta Bruta vs Venta Neta en el Dashboard
 *   - Total de Comisiones Pagadas
 *   - Pie chart "Ingresos por Metodo de Pago"
 *   - Gasto Financiero en el Estado de Resultados
 *
 * IMPORTANTE: todas las consultas se filtran por la razon_social_id de la
 * sesion (multi-tenant) y por el rango de fechas indicado.
 */
export interface PagosResumen {
  /** Suma de monto_bruto del periodo (lo que el cliente pago en total). */
  totalBruto: number
  /** Suma de monto_neto del periodo (lo que efectivamente entro al banco). */
  totalNeto: number
  /** totalBruto - totalNeto. Comisiones bancarias del periodo. */
  totalComisiones: number
  /**
   * Distribucion por metodo, ya etiquetada para visualizacion.
   * - Efectivo agrupa todos los pagos en cash.
   * - Para Banco/Link_Pago se usa el `banco` de cuentas_config (ej. "BAC",
   *   "Banpais"). Si no se pudo resolver, cae a "Banco" / "Link de Pago".
   */
  porMetodo: {
    label: string
    metodo_pago: string
    bruto: number
    neto: number
    comision: number
    count: number
  }[]
  /** True si la tabla ventas_pagos_detalle aun no existe (migracion pendiente). */
  featurePending?: boolean
}

/**
 * Construye el rango ISO inclusivo para un anio/mes opcional.
 * - Sin anio: undefined (sin filtro de fecha; "todos").
 * - Con anio sin mes: enero 1 -> diciembre 31 23:59:59.
 * - Con anio y mes: primer al ultimo dia del mes.
 */
function buildDateRange(anio?: number, mes?: number): { start?: string; end?: string } {
  if (!anio) return {}
  // Limites en strings naive (sin offset) para casar con las fechas HN-as-UTC
  // y NO desfasar los bordes 6h (medianoche local -> 06:00Z). Solo usamos Date
  // para el NUMERO del ultimo dia del mes, no para el instante.
  if (mes) {
    const mm = String(mes).padStart(2, "0")
    const dd = String(new Date(anio, mes, 0).getDate()).padStart(2, "0")
    return { start: `${anio}-${mm}-01T00:00:00`, end: `${anio}-${mm}-${dd}T23:59:59` }
  }
  return { start: `${anio}-01-01T00:00:00`, end: `${anio}-12-31T23:59:59` }
}

/**
 * Obtiene el resumen de pagos del periodo. Resiliente:
 *   - Si la tabla ventas_pagos_detalle no existe -> featurePending: true,
 *     totales en 0 y porMetodo vacio (UI degradada).
 *   - Si no hay sesion valida -> mismo objeto vacio (no rompe el dashboard).
 */
export async function getPagosResumen(
  anio?: number,
  mes?: number
): Promise<{ data: PagosResumen; error: string | null }> {
  const empty: PagosResumen = {
    totalBruto: 0,
    totalNeto: 0,
    totalComisiones: 0,
    porMetodo: [],
  }

  if (!isSupabaseConfigured()) return { data: empty, error: null }

  const supabase = createClient()
  if (!supabase) return { data: empty, error: null }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: empty, error: null }

  const { start, end } = buildDateRange(anio, mes)

  try {
    // Estrategia: filtrar primero los venta_id del tenant (+ rango de fechas)
    // desde ventas_encabezado y luego leer ventas_pagos_detalle con .in().
    // Esto evita el problema de PostgREST donde los filtros sobre tablas
    // relacionadas con !inner no siempre se aplican correctamente desde el
    // cliente JS de Supabase.

    // 1) Obtener los IDs de ventas VIGENTES del tenant en el periodo.
    const { data: encabData, error: encabErr } = await ejecutarVigentes<{ id: number }[] | null>((filtrar) => {
      let encabQ = supabase
        .from("ventas_encabezado")
        .select("id")
        .eq("razon_social_id", stamp.razon_social_id!)
      if (filtrar) encabQ = encabQ.is("anulada_at", null)
      if (start && end) {
        encabQ = encabQ.gte("fecha_venta", start).lte("fecha_venta", end)
      }
      return encabQ
    })

    if (encabErr) {
      return { data: empty, error: encabErr.message || "Error" }
    }

    const ventaIds = (encabData || []).map((r: { id: number }) => r.id)

    // Sin ventas en el periodo: devolver totales en cero (es un resultado
    // valido — puede que los filtros de fecha no tengan ventas).
    if (ventaIds.length === 0) {
      return { data: { ...empty }, error: null }
    }

    // 2) Leer los pagos de esas ventas.
    const { data, error } = await supabase
      .from("ventas_pagos_detalle")
      .select(`
        metodo_pago,
        monto_bruto,
        porcentaje_comision,
        cuentas_config(nombre)
      `)
      .in("venta_id", ventaIds)

    if (error) {
      if (/does not exist|ventas_pagos_detalle/i.test(error.message)) {
        return { data: { ...empty, featurePending: true }, error: null }
      }
      return { data: empty, error: error.message }
    }

    let totalBruto = 0
    let totalComisiones = 0
    const acc = new Map<
      string,
      { metodo_pago: string; bruto: number; comision: number; count: number }
    >()

    type Row = {
      metodo_pago: string
      monto_bruto: number | null
      porcentaje_comision: number | null
      // La columna real en `cuentas_config` es `nombre` (no `banco`).
      cuentas_config?: { nombre?: string } | null
    }

    for (const raw of (data || []) as Row[]) {
      const metodo = raw.metodo_pago
      const banco = raw.cuentas_config?.nombre
      const bruto = Number(raw.monto_bruto) || 0
      // La comision se deriva del % del banco aplicado a la linea (fuente de
      // verdad). Es mas robusto que `monto_bruto - monto_neto`, que quedaba en
      // 0 cuando `monto_neto` se persistio igual al bruto en datos historicos.
      const pct = Number(raw.porcentaje_comision) || 0
      const comision = +(bruto * (pct / 100)).toFixed(2)

      // Etiqueta amigable: el cliente del Pie chart distingue bancos reales.
      let label: string
      if (metodo === "Efectivo") label = "Efectivo"
      else if (metodo === "Link_Pago") label = banco ? `${banco} (Link)` : "Link de Pago"
      else if (metodo === "Banco") label = banco || "Banco"
      else if (metodo === "Credito") label = "Credito"
      else label = "Otro"

      totalBruto += bruto
      totalComisiones += comision

      const cur = acc.get(label) || { metodo_pago: metodo, bruto: 0, comision: 0, count: 0 }
      cur.bruto += bruto
      cur.comision += comision
      cur.count += 1
      acc.set(label, cur)
    }

    const porMetodo = Array.from(acc.entries())
      .map(([label, v]) => ({
        label,
        metodo_pago: v.metodo_pago,
        bruto: +v.bruto.toFixed(2),
        neto: +(v.bruto - v.comision).toFixed(2),
        comision: +v.comision.toFixed(2),
        count: v.count,
      }))
      .sort((a, b) => b.bruto - a.bruto)

    const totalComisionesR = +totalComisiones.toFixed(2)
    return {
      data: {
        totalBruto: +totalBruto.toFixed(2),
        totalNeto: +(totalBruto - totalComisionesR).toFixed(2),
        totalComisiones: totalComisionesR,
        porMetodo,
      },
      error: null,
    }
  } catch (err) {
    console.error("[getPagosResumen] error:", err)
    return { data: empty, error: "Error de conexion" }
  }
}

/**
 * Solo el total de comisiones del periodo. Atajo para el Estado de Resultados
 * cuando no se necesita el detalle por metodo. Filtra por razon_social_id.
 */
export async function getComisionesPeriodo(
  anio: number,
  mes?: number
): Promise<{ data: number; error: string | null; featurePending?: boolean }> {
  const { data, error } = await getPagosResumen(anio, mes)
  return {
    data: data?.totalComisiones ?? 0,
    error,
    featurePending: data?.featurePending,
  }
}

/**
 * Devuelve un Map<venta_id, etiqueta> con la categorizacion del metodo
 * agregado de cada venta:
 *   "Efectivo"  -> todas las lineas son efectivo
 *   "Banco"     -> todas las lineas son Banco o Link_Pago
 *   "Mixto"     -> al menos una de efectivo y una de banco
 *   "Credito"   -> solo lineas Credito (saldo CXC)
 *   "Otro"      -> solo lineas Otro
 *
 * Ventas sin filas en ventas_pagos_detalle no aparecen en el Map (tipicamente
 * son ventas a credito puro o creadas antes de la migracion 011).
 */
export async function getMetodosPagoPorVenta(
  ventaIds: number[]
): Promise<{ data: Map<number, string>; error: string | null }> {
  const empty = new Map<number, string>()
  if (ventaIds.length === 0) return { data: empty, error: null }

  if (!isSupabaseConfigured()) return { data: empty, error: null }
  const supabase = createClient()
  if (!supabase) return { data: empty, error: null }

  try {
    type Row = { venta_id: number; metodo_pago: string }
    // Chunk de ids para no exceder el largo de URL con miles de ventas.
    const resultados = await Promise.all(
      chunk(ventaIds, IN_CHUNK).map((grupo) =>
        supabase.from("ventas_pagos_detalle").select("venta_id, metodo_pago").in("venta_id", grupo)
      )
    )
    const filas: Row[] = []
    for (const r of resultados) {
      if (r.error) {
        // Tabla pendiente: regresa map vacio para que la UI muestre fallback.
        if (/does not exist|ventas_pagos_detalle/i.test(r.error.message)) {
          return { data: empty, error: null }
        }
        return { data: empty, error: r.error.message }
      }
      filas.push(...((r.data || []) as Row[]))
    }

    const sets = new Map<number, Set<string>>()
    for (const r of filas) {
      const s = sets.get(r.venta_id) || new Set<string>()
      s.add(r.metodo_pago)
      sets.set(r.venta_id, s)
    }

    // FALLBACK: las ventas sin fila en ventas_pagos_detalle (p. ej. las que se
    // crearon pendientes y se cobraron luego con "Registrar abono", que escribe
    // en `pagos_ventas` y no en el desglose) quedarian con badge vacio. Para
    // esas, derivamos el metodo desde `pagos_ventas.metodo_pago`.
    const sinDesglose = ventaIds.filter((id) => !sets.has(id))
    if (sinDesglose.length > 0) {
      type PagoRow = { venta_id: number; metodo_pago: string | null }
      const abonoResultados = await Promise.all(
        chunk(sinDesglose, IN_CHUNK).map((grupo) =>
          supabase.from("pagos_ventas").select("venta_id, metodo_pago").in("venta_id", grupo)
        )
      )
      for (const r of abonoResultados) {
        // Si la tabla no existe u otro error: ignoramos el fallback (badge queda vacio).
        if (r.error) continue
        for (const row of (r.data || []) as PagoRow[]) {
          if (!row.metodo_pago) continue
          const s = sets.get(row.venta_id) || new Set<string>()
          s.add(row.metodo_pago)
          sets.set(row.venta_id, s)
        }
      }
    }

    const out = new Map<number, string>()
    for (const [id, set] of sets) {
      // Normaliza etiquetas de ambas fuentes (ventas_pagos_detalle usa
      // 'Efectivo'/'Banco'/'Link_Pago'/'Credito'/'Otro'; pagos_ventas suele
      // usar 'Efectivo'/'Banco'/'Otro'). Cualquier valor no reconocido -> Otro.
      const tieneEfectivo = set.has("Efectivo")
      const tieneBanco = set.has("Banco") || set.has("Link_Pago")
      const tieneCredito = set.has("Credito")
      const conocidos = new Set(["Efectivo", "Banco", "Link_Pago", "Credito"])
      const tieneOtro = set.has("Otro") || [...set].some((m) => !conocidos.has(m))

      if (tieneEfectivo && tieneBanco) out.set(id, "Mixto")
      else if (tieneEfectivo) out.set(id, "Efectivo")
      else if (tieneBanco) out.set(id, "Banco")
      else if (tieneCredito) out.set(id, "Credito")
      else if (tieneOtro) out.set(id, "Otro")
    }

    return { data: out, error: null }
  } catch (err) {
    console.error("[getMetodosPagoPorVenta] error:", err)
    return { data: empty, error: "Error de conexion" }
  }
}

/**
 * Devuelve un Map<venta_id, string[]> con los nombres de las CUENTAS DESTINO
 * (bancarias) de cada venta — las cuentas de `cuentas_config` referenciadas
 * por las lineas de pago Banco/Link_Pago de esa venta. Sirve para que el
 * Historial muestre, junto al metodo "Banco", a que cuenta entro el dinero.
 *
 * - Solo considera lineas Banco/Link_Pago (las de efectivo/credito no tienen
 *   cuenta destino). Nombres distintos y ordenados; una venta puede tener mas
 *   de una cuenta si se cobro en varios bancos.
 * - Ventas sin lineas bancarias (o sin cuenta resuelta) no entran en el Map.
 * - Resiliente: si la tabla no existe -> Map vacio (la UI muestra solo el
 *   metodo, sin cuenta).
 */
export async function getCuentasDestinoPorVenta(
  ventaIds: number[]
): Promise<{ data: Map<number, string[]>; error: string | null }> {
  const empty = new Map<number, string[]>()
  if (ventaIds.length === 0) return { data: empty, error: null }

  if (!isSupabaseConfigured()) return { data: empty, error: null }
  const supabase = createClient()
  if (!supabase) return { data: empty, error: null }

  try {
    type Row = {
      venta_id: number
      metodo_pago: string
      cuenta_id: number | null
      // La columna real en `cuentas_config` es `nombre` (mismo embed que getPagosResumen).
      cuentas_config?: { nombre?: string } | null
    }
    const resultados = await Promise.all(
      chunk(ventaIds, IN_CHUNK).map((grupo) =>
        supabase
          .from("ventas_pagos_detalle")
          .select("venta_id, metodo_pago, cuenta_id, cuentas_config(nombre)")
          .in("venta_id", grupo)
      )
    )

    const sets = new Map<number, Set<string>>()
    for (const r of resultados) {
      if (r.error) {
        // Tabla pendiente u otro error: degradamos a Map vacio (sin cuenta).
        if (/does not exist|ventas_pagos_detalle/i.test(r.error.message)) {
          return { data: empty, error: null }
        }
        return { data: empty, error: r.error.message }
      }
      for (const raw of (r.data || []) as Row[]) {
        // Solo lineas bancarias tienen cuenta destino relevante.
        if (raw.metodo_pago !== "Banco" && raw.metodo_pago !== "Link_Pago") continue
        const nombre = raw.cuentas_config?.nombre?.trim()
        if (!nombre) continue
        const s = sets.get(raw.venta_id) || new Set<string>()
        s.add(nombre)
        sets.set(raw.venta_id, s)
      }
    }

    const out = new Map<number, string[]>()
    for (const [id, set] of sets) {
      out.set(id, Array.from(set).sort((a, b) => a.localeCompare(b, "es")))
    }
    return { data: out, error: null }
  } catch (err) {
    console.error("[getCuentasDestinoPorVenta] error:", err)
    return { data: empty, error: "Error de conexion" }
  }
}

/** Comision bancaria agregada de UNA venta (suma de sus lineas de pago). */
export interface ComisionVenta {
  /** Suma de monto_bruto de la venta. */
  bruto: number
  /** Comision total = Σ monto_bruto * porcentaje_comision / 100. */
  comision: number
  /** % combinado (blended) de la venta = comision / bruto * 100. */
  pct: number
  /** bruto - comision (lo que efectivamente entra). */
  neto: number
}

/**
 * Devuelve un Map<venta_id, ComisionVenta> con la comision bancaria agregada de
 * cada venta, para auditoria en el Historial. La comision se deriva del % del
 * banco (`monto_bruto * porcentaje_comision / 100`), mas robusto que
 * `monto_bruto - monto_neto`. Ventas a credito puro / sin comision no entran en
 * el Map (la UI cae a "—"). Resiliente: si la tabla no existe -> Map vacio.
 */
export async function getComisionesPorVenta(
  ventaIds: number[]
): Promise<{ data: Map<number, ComisionVenta>; error: string | null }> {
  const empty = new Map<number, ComisionVenta>()
  if (ventaIds.length === 0) return { data: empty, error: null }

  if (!isSupabaseConfigured()) return { data: empty, error: null }
  const supabase = createClient()
  if (!supabase) return { data: empty, error: null }

  try {
    type Row = { venta_id: number; monto_bruto: number | null; porcentaje_comision: number | null }
    const resultados = await Promise.all(
      chunk(ventaIds, IN_CHUNK).map((grupo) =>
        supabase.from("ventas_pagos_detalle").select("venta_id, monto_bruto, porcentaje_comision").in("venta_id", grupo)
      )
    )
    const filas: Row[] = []
    for (const r of resultados) {
      if (r.error) {
        if (/does not exist|ventas_pagos_detalle/i.test(r.error.message)) {
          return { data: empty, error: null }
        }
        return { data: empty, error: r.error.message }
      }
      filas.push(...((r.data || []) as Row[]))
    }

    const acc = new Map<number, { bruto: number; comision: number }>()
    for (const r of filas) {
      const bruto = Number(r.monto_bruto) || 0
      const pct = Number(r.porcentaje_comision) || 0
      const cur = acc.get(r.venta_id) || { bruto: 0, comision: 0 }
      cur.bruto += bruto
      cur.comision += bruto * (pct / 100)
      acc.set(r.venta_id, cur)
    }

    const out = new Map<number, ComisionVenta>()
    for (const [id, v] of acc) {
      const bruto = +v.bruto.toFixed(2)
      const comision = +v.comision.toFixed(2)
      // Solo interesa cuando hay comision real (auditoria). Sin comision -> "—".
      if (comision <= 0) continue
      out.set(id, {
        bruto,
        comision,
        pct: bruto > 0 ? +((comision / bruto) * 100).toFixed(2) : 0,
        neto: +(bruto - comision).toFixed(2),
      })
    }

    return { data: out, error: null }
  } catch (err) {
    console.error("[getComisionesPorVenta] error:", err)
    return { data: empty, error: "Error de conexion" }
  }
}

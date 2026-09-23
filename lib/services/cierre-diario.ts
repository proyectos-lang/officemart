"use client"

/**
 * Servicio de Cierre Diario.
 *
 * Pieza central: `getCierreDiario(fechaISO)` ejecuta en paralelo todas las
 * consultas necesarias para construir un cierre del dia (resumen + 3 detalles).
 *
 * Multi-tenant: TODAS las queries se filtran por `razon_social_id` del
 * usuario logueado (extraido de `getTenantStamp`). Si no hay tenant valido,
 * regresamos vacio para no fugar datos cruzados.
 *
 * Resiliencia: si la migracion 011 (ventas_pagos_detalle, caja_chica) o la
 * 012 (vista_cierre_diario) aun no se aplicaron, las consultas que dependen
 * de ellas devuelven valores neutros (0 / [] ). Cualquier error que NO sea
 * "tabla/vista inexistente" se loggea y se propaga como `featurePending`.
 */

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp } from "@/lib/services/tenant-stamp"
import { getHondurasDayRange } from "@/lib/utils/honduras-time"
import { ejecutarVigentes } from "@/lib/services/ventas-filtros"

// ==================== TIPOS ====================

export interface CierreResumen {
  fecha: string                  // YYYY-MM-DD
  cantidad_tickets: number
  total_ventas: number
  ingresos_efectivo: number
  ingresos_banco_bruto: number
  ingresos_banco_neto: number
  credito_total: number
  comisiones_total: number
  /**
   * Total de SALIDAS de caja chica del dia (tipo='Salida' en
   * caja_chica_movimientos). Cubre cualquier salida de efectivo,
   * incluso si NO esta vinculada a un gasto formal. Suma absoluta
   * (los movimientos se almacenan con monto negativo para salidas).
   */
  total_egresos_caja: number
  /**
   * Inyecciones manuales de efectivo (tipo='Ingreso_Manual'). Se
   * separan conceptualmente de las ventas en efectivo para no inflar
   * el reporte de ventas — provienen de caja chica, no del cobro.
   */
  ingresos_efectivo_manual: number
  /** Pagos de gastos hechos en efectivo durante el dia (caja chica, ref_tipo='gasto'). */
  egresos_gastos_efectivo: number
  /** Pagos de gastos hechos por banco durante el dia (cuenta_movimientos, ref_tipo='gasto'). */
  egresos_gastos_banco: number
}

/**
 * Gasto registrado con `fecha_gasto` igual al dia del cierre, sin importar
 * como (o si) se pago. Contexto para la seccion "Gastos del Dia".
 */
export interface GastoDelDia {
  id: number
  fecha_gasto: string
  monto: number
  metodo_pago: string | null
  descripcion: string | null
  concepto_nombre: string | null
}

/**
 * Movimiento individual de ingreso de efectivo del dia (fuente:
 * caja_chica_movimientos con tipo IN ('Ingreso_Venta','Ingreso_Manual')).
 * Si `ref_tipo='venta'`, la UI puede generar un link a la venta original
 * usando `ref_id`.
 */
export interface IngresoEfectivoDetalle {
  id: number
  fecha: string                  // created_at de caja_chica_movimientos
  tipo: "Ingreso_Venta" | "Ingreso_Manual"
  monto: number
  concepto: string | null
  cajero: string | null
  ref_tipo: string | null
  ref_id: number | null
}

/**
 * Linea individual de un pago de gasto del dia. La pagina del cierre la
 * usa para listar el detalle "Gastos Pagados Hoy".
 *
 * Como NO existe una tabla `gastos_pagos_detalle`, los pagos se reconstruyen
 * desde `caja_chica_movimientos` (efectivo) y `cuenta_movimientos` (banco)
 * filtrando por `ref_tipo = 'gasto'` y la fecha del dia.
 */
export interface PagoGastoRow {
  id: number
  fecha_pago: string
  monto: number
  metodo_pago: 'Efectivo' | 'Banco'
  cuenta_nombre: string | null
  concepto: string | null
  gasto_id: number
  concepto_gasto: string | null
  proveedor_nombre: string | null
}

/**
 * Detalle individual de un movimiento bancario del dia (lo que se muestra
 * al expandir una cuenta en el cierre diario). Viene directo de
 * `cuenta_movimientos` con el `usuario` que registro la transaccion para
 * trazabilidad. Si `ref_tipo='venta'`, la UI puede usar `ref_id` para
 * enlazar al detalle de la venta correspondiente.
 */
export interface CuentaMovimientoDetalle {
  id: number
  fecha: string
  tipo: "Ingreso" | "Egreso"
  monto: number
  concepto: string | null
  saldo_resultante: number
  usuario: string | null
  ref_tipo: string | null
  ref_id: number | null
}

/**
 * Resumen por cuenta bancaria del dia.
 * Fuente unica: tabla `cuenta_movimientos` (no `ventas_pagos_detalle`).
 * Asi el cierre refleja TODO el flujo bancario del dia (ventas, gastos,
 * transferencias, ajustes manuales), no solo las ventas con tarjeta.
 */
export interface DesgloseBanco {
  cuenta_id: number | null
  banco: string                       // "BAC", "Banpais", o "Sin cuenta"
  cantidad_movimientos: number
  total_ingresos: number              // sumatoria monto donde tipo='Ingreso'
  total_egresos: number               // sumatoria monto donde tipo='Egreso'
  saldo_final_dia: number             // saldo_resultante del ultimo mov del dia
  movimientos: CuentaMovimientoDetalle[]
}

export interface ProductoVendido {
  producto_id: number | null
  producto_codigo: string | null
  producto_nombre: string
  cantidad: number
  total_vendido: number
}

export interface CajaSesionRef {
  id: number
  estado: "Abierta" | "Cerrada"
  saldo_inicial: number
  saldo_final_real: number | null
  fecha_apertura: string
  fecha_cierre: string | null
  usuario_apertura: string | null
  usuario_cierre: string | null
}

export interface CajaMovimientoRow {
  id: number
  fecha: string
  tipo: string                   // 'Apertura'|'Ingreso_Manual'|'Ingreso_Venta'|'Salida'|'Transferencia_Banco'|'Cierre'
  monto: number
  concepto: string | null
  saldo_resultante: number
  cuenta_destino_id: number | null
  cuenta_destino_nombre?: string | null
}

/** Devolucion registrada en el dia del cierre. */
export interface DevolucionDelDia {
  id: number
  numero_devolucion: string | null
  monto_total: number
  destino_reembolso: string
  motivo: string | null
  numero_factura: string | null
}

/**
 * Desglose del dinero del dia por METODO de cobro, reconstruido desde
 * `ventas_pagos_detalle` de las ventas del dia. Sirve para dejar claro que
 * el total vendido = efectivo + banco (bruto) + credito, y cuanto de banco
 * se fue en comisiones (banco neto = bruto - comisiones). Evita la confusion
 * de comparar "Total Ventas" (bruto) contra "Ingresos en Bancos" (neto).
 */
export interface DesgloseVentasMetodo {
  /** Total vendido del dia (suma de total_venta de los tickets). */
  totalVentas: number
  /** Cobrado en efectivo (bruto = neto, no hay comision en efectivo). */
  efectivo: number
  /** Cobrado por banco/tarjeta/link, antes de comisiones. */
  bancoBruto: number
  /** Comisiones bancarias del dia (bancoBruto - bancoNeto). */
  comisiones: number
  /** Neto que entra al banco (bancoBruto - comisiones). */
  bancoNeto: number
  /** Otorgado al credito (no entra dinero hoy). */
  credito: number
  /** Otros metodos no clasificados. */
  otros: number
  /**
   * Ventas del dia SIN ningun renglon en `ventas_pagos_detalle` (no se
   * pudo clasificar su metodo). Su monto se reporta aparte para que el
   * desglose siga cuadrando contra `totalVentas`.
   */
  sinDesglose: number
}

export interface CierreDiarioData {
  resumen: CierreResumen
  bancos: DesgloseBanco[]
  productos: ProductoVendido[]
  caja: {
    sesiones: CajaSesionRef[]
    movimientos: CajaMovimientoRow[]
  }
  /** Pagos a gastos realizados durante este dia (cualquier metodo). */
  pagosGastos: PagoGastoRow[]
  /** Gastos cuyo `fecha_gasto` coincide con la fecha del cierre. */
  gastosDelDia: GastoDelDia[]
  /**
   * Detalle de movimientos de ingreso de efectivo del dia
   * (caja_chica_movimientos con tipo IN ('Ingreso_Venta','Ingreso_Manual')).
   * Se usa para el desplegable "Detalle de Ingresos en Efectivo".
   */
  detalleEfectivo: IngresoEfectivoDetalle[]
  /** Devoluciones (notas de credito) registradas en el dia. */
  devoluciones: DevolucionDelDia[]
  /** Suma de las devoluciones del dia. */
  totalDevoluciones: number
  /**
   * Desglose del total vendido por metodo de cobro (efectivo / banco bruto /
   * comisiones / neto / credito). Deja claro que nada se "pierde" al cerrar.
   */
  desgloseMetodos: DesgloseVentasMetodo
  /** True si alguna parte del feature esta pendiente de migracion. */
  featurePending: boolean
}

// ==================== HELPERS ====================

/**
 * Detecta el tipico error de Supabase cuando una TABLA o VISTA no existe.
 * IMPORTANTE: NO debe matchear errores de embed/relation de PostgREST
 * (codigo PGRST200 "could not find the relationship"), porque esos
 * aparecen cuando una FK polimorfica (ej. ref_id) no esta declarada
 * formalmente como FK en BD, y eso NO significa que falte una migracion.
 */
function isMissingRelation(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  // Postgres puro: "relation X does not exist"
  if (err.code === "42P01") return true
  // PostgREST cuando la TABLA/VISTA no existe en el cache del esquema.
  // Distinguimos esto de PGRST200 (relacion/embed no encontrado).
  if (err.code === "PGRST205") return true
  // Mensajes que solo aparecen cuando la TABLA o VISTA falta.
  return (
    /relation\s+"?[\w.]+"?\s+does not exist/.test(msg) ||
    msg.includes("could not find the table") ||
    msg.includes("could not find the function")
  )
}

/**
 * Genera el rango [start, end) del dia en ISO bajo la convencion HN-as-UTC
 * que usa el modulo de caja chica y los timestamps de la app: el valor
 * almacenado representa la hora local de Honduras codificada como UTC
 * (ver `lib/utils/honduras-time.ts`). Construimos `start`/`end` exactamente
 * como `{fechaISO}T00:00:00.000Z` para que los filtros .gte/.lt coincidan
 * con los timestamps escritos via `getHondurasNowISO()` sin depender de
 * la TZ del browser ni del servidor.
 */
function rangoDia(fechaISO: string): { start: string; end: string } {
  return getHondurasDayRange(fechaISO)
}

// ==================== CARGA PRINCIPAL ====================

export async function getCierreDiario(fechaISO: string): Promise<{
  data: CierreDiarioData
  error: string | null
}> {
  // Estructura vacia consistente para casos de error / tenant invalido.
  const empty: CierreDiarioData = {
    resumen: {
      fecha: fechaISO,
      cantidad_tickets: 0,
      total_ventas: 0,
      ingresos_efectivo: 0,
      ingresos_banco_bruto: 0,
      ingresos_banco_neto: 0,
      credito_total: 0,
      comisiones_total: 0,
      egresos_gastos_efectivo: 0,
      egresos_gastos_banco: 0,
      total_egresos_caja: 0,
      ingresos_efectivo_manual: 0,
    },
    bancos: [],
    productos: [],
    caja: { sesiones: [], movimientos: [] },
    pagosGastos: [],
    gastosDelDia: [],
    detalleEfectivo: [],
    devoluciones: [],
    totalDevoluciones: 0,
    desgloseMetodos: {
      totalVentas: 0,
      efectivo: 0,
      bancoBruto: 0,
      comisiones: 0,
      bancoNeto: 0,
      credito: 0,
      otros: 0,
      sinDesglose: 0,
    },
    featurePending: false,
  }

  if (!isSupabaseConfigured()) return { data: empty, error: null }
  const supabase = createClient()
  if (!supabase) return { data: empty, error: "Cliente no disponible" }

  const stamp = await getTenantStamp(supabase)
  const tenantId = stamp.razon_social_id
  if (tenantId == null) return { data: empty, error: null }

  const { start, end } = rangoDia(fechaISO)
  let featurePending = false

  // ---- Resumen: SIEMPRE calculado desde las tablas ------------------------
  // Antes se leia primero `vista_cierre_diario`; desde officemart-003 no se
  // usa: la vista clonada no excluye las ventas ANULADAS (y sus columnas no
  // coinciden con las que este resumen necesita). El calculo directo lee
  // ventas_encabezado (solo vigentes) y ventas_pagos_detalle.
  const resumen: CierreResumen = { ...empty.resumen }
  {
    const { data: ventasData } = await ejecutarVigentes<{ id: number; total_venta: number }[] | null>((filtrar) => {
      let q = supabase
        .from("ventas_encabezado")
        .select("id, total_venta")
        .eq("razon_social_id", tenantId)
        .gte("fecha_venta", start)
        .lt("fecha_venta", end)
      if (filtrar) q = q.is("anulada_at", null)
      return q
    })

    const ventas = ventasData || []
    resumen.cantidad_tickets = ventas.length
    resumen.total_ventas = ventas.reduce((acc, v) => acc + Number(v.total_venta || 0), 0)

    if (ventas.length > 0) {
      const ventaIds = ventas.map((v) => v.id)
      const { data: pagosData, error: pagosErr } = await supabase
        .from("ventas_pagos_detalle")
        .select("metodo_pago, monto_bruto, monto_neto")
        .in("venta_id", ventaIds)

      if (pagosErr && isMissingRelation(pagosErr)) {
        featurePending = true
      } else if (pagosData) {
        for (const p of pagosData) {
          const bruto = Number(p.monto_bruto || 0)
          const neto = Number(p.monto_neto || 0)
          if (p.metodo_pago === "Efectivo") resumen.ingresos_efectivo += bruto
          else if (p.metodo_pago === "Banco" || p.metodo_pago === "Link_Pago") {
            resumen.ingresos_banco_bruto += bruto
            resumen.ingresos_banco_neto += neto
          } else if (p.metodo_pago === "Credito") resumen.credito_total += bruto
          resumen.comisiones_total += bruto - neto
        }
      }
    }
  }

  // ---- Pre-paso: IDs de ventas del dia ----------------------------------
  // Resolvemos primero los venta_id del dia para evitar el bug del cliente
  // JS de Supabase con !inner + filtros sobre la tabla embebida (los .gte/.lt
  // sobre `ventas_encabezado.fecha_venta` no se aplican consistentemente).
  // Con un IN explicito sobre venta_id la query es trivial y siempre correcta.
  let ventaIdsDelDia: number[] = []
  {
    const { data: encabData } = await ejecutarVigentes<{ id: number }[] | null>((filtrar) => {
      let q = supabase
        .from("ventas_encabezado")
        .select("id")
        .eq("razon_social_id", tenantId)
        .gte("fecha_venta", start)
        .lt("fecha_venta", end)
      if (filtrar) q = q.is("anulada_at", null)
      return q
    })
    ventaIdsDelDia = (encabData || []).map((r: { id: number }) => r.id)
  }

  // ---- Tab 1: Desglose por cuenta bancaria ------------------------------
  // Fuente: `cuenta_movimientos` con JOIN a `cuentas_config` para el nombre
  // del banco. Filtramos por razon_social_id (RLS + defensa explicita) y
  // por `fecha` dentro del rango [start, end) del dia consultado.
  // Para cada cuenta calculamos:
  //   - total_ingresos: SUM(monto) WHERE tipo='Ingreso'
  //   - total_egresos: SUM(monto) WHERE tipo='Egreso'
  //   - saldo_final_dia: saldo_resultante del ULTIMO movimiento del dia
  //   - movimientos[]: detalle ordenado cronologicamente
  const bancos: DesgloseBanco[] = []
  {
    const { data, error } = await supabase
      .from("cuenta_movimientos")
      .select(`
        id,
        cuenta_id,
        fecha,
        tipo,
        monto,
        concepto,
        saldo_resultante,
        usuario,
        ref_tipo,
        ref_id,
        cuentas_config:cuenta_id (id, nombre)
      `)
      .eq("razon_social_id", tenantId)
      .gte("fecha", start)
      .lt("fecha", end)
      .order("cuenta_id", { ascending: true })
      .order("fecha", { ascending: true })
      .order("id", { ascending: true })

    if (error && isMissingRelation(error)) {
      featurePending = true
    } else if (error) {
      console.warn("[cierre-diario] error bancos:", error.message)
    } else {
      // Agrupamos por cuenta_id en memoria. Las filas vienen ya ordenadas
      // cronologicamente, por lo que el ULTIMO push a `movimientos` por
      // cuenta tiene el `saldo_resultante` final del dia.
      const map = new Map<number | null, DesgloseBanco>()
      for (const r of data || []) {
        const cuenta: { id: number; nombre: string } | null =
          (Array.isArray(r.cuentas_config) ? r.cuentas_config[0] : r.cuentas_config) || null
        const key = (r.cuenta_id ?? cuenta?.id) ?? null
        const existing: DesgloseBanco = map.get(key) ?? {
          cuenta_id: key,
          banco: cuenta?.nombre ?? "Sin cuenta",
          cantidad_movimientos: 0,
          total_ingresos: 0,
          total_egresos: 0,
          saldo_final_dia: 0,
          movimientos: [],
        }

        const monto = Number(r.monto || 0)
        const tipo = (r.tipo as "Ingreso" | "Egreso") || "Ingreso"
        existing.cantidad_movimientos += 1
        if (tipo === "Ingreso") existing.total_ingresos += monto
        else existing.total_egresos += monto

        const detalle: CuentaMovimientoDetalle = {
          id: Number(r.id),
          fecha: r.fecha,
          tipo,
          monto,
          concepto: r.concepto ?? null,
          saldo_resultante: Number(r.saldo_resultante || 0),
          usuario: r.usuario ?? null,
          ref_tipo: r.ref_tipo ?? null,
          ref_id: r.ref_id != null ? Number(r.ref_id) : null,
        }
        existing.movimientos.push(detalle)
        // Como el orden es cronologico ASC, el saldo del ultimo registro
        // que veamos es el saldo final del dia.
        existing.saldo_final_dia = detalle.saldo_resultante

        map.set(key, existing)
      }
      // Orden por movimiento mas alto: las cuentas con mas actividad arriba.
      bancos.push(
        ...Array.from(map.values()).sort(
          (a, b) =>
            b.total_ingresos + b.total_egresos -
            (a.total_ingresos + a.total_egresos)
        )
      )

      // OVERRIDE de ingresos_banco_bruto / ingresos_banco_neto.
      // Fuente unica: sumatoria de `total_ingresos` por cuenta desde
      // cuenta_movimientos. La vista `vista_cierre_diario` calculaba
      // estos campos a partir de ventas_pagos_detalle (solo cobros con
      // tarjeta), lo que dejaba en 0 transferencias, depositos y otros
      // ingresos bancarios reales del dia. Como cuenta_movimientos
      // registra el monto ya neto que entro a la cuenta, ambos campos
      // (bruto/neto) reciben el mismo valor.
      const totalIngresosBanco = bancos.reduce(
        (acc, b) => acc + b.total_ingresos,
        0
      )
      resumen.ingresos_banco_bruto = +totalIngresosBanco.toFixed(2)
      resumen.ingresos_banco_neto = +totalIngresosBanco.toFixed(2)
    }
  }

  // ---- Tab 2: Productos vendidos ----------------------------------------
  const productos: ProductoVendido[] = []
  if (ventaIdsDelDia.length > 0) {
    const { data, error } = await supabase
      .from("ventas_detalle")
      .select(`
        id,
        producto_id,
        cantidad,
        precio_unitario,
        productos:producto_id (id, codigo_barras, nombre)
      `)
      .in("venta_id", ventaIdsDelDia)

    if (error) {
      console.warn("[cierre-diario] error productos:", error.message)
    } else {
      const detalles = data || []

      // Lineas de Venta Rapida (producto_id NULL): su nombre no viene por join a
      // `productos` sino de la tabla mapa `ventas_detalle_descripcion` (script
      // 045). Se lee best-effort: si el script no existe, cae al texto generico.
      const idsSinProducto = detalles
        .filter((r) => r.producto_id == null)
        .map((r) => r.id)
      const descById = new Map<number, string>()
      if (idsSinProducto.length > 0) {
        const { data: descData } = await supabase
          .from("ventas_detalle_descripcion")
          .select("detalle_id, descripcion")
          .in("detalle_id", idsSinProducto)
        for (const d of (descData || []) as { detalle_id: number; descripcion: string }[]) {
          descById.set(d.detalle_id, d.descripcion)
        }
      }

      // Agrupa por producto del catalogo (por id) y, para Venta Rapida, por su
      // texto capturado (asi dos lineas rapidas distintas no se mezclan).
      const map = new Map<string, ProductoVendido>()
      for (const r of detalles) {
        const prod: { id: number; codigo_barras: string | null; nombre: string } | null =
          (Array.isArray(r.productos) ? r.productos[0] : r.productos) || null
        const cant = Number(r.cantidad || 0)
        const precio = Number(r.precio_unitario || 0)

        let key: string
        let nombre: string
        if (r.producto_id != null) {
          key = `p:${r.producto_id}`
          nombre = prod?.nombre ?? "Producto eliminado"
        } else {
          const desc = (descById.get(r.id) || "").trim()
          nombre = desc || "Venta rapida"
          key = `d:${nombre.toLowerCase()}`
        }

        const existing = map.get(key) ?? {
          producto_id: r.producto_id ?? null,
          producto_codigo: prod?.codigo_barras ?? null,
          producto_nombre: nombre,
          cantidad: 0,
          total_vendido: 0,
        }
        existing.cantidad += cant
        existing.total_vendido += cant * precio
        map.set(key, existing)
      }
      productos.push(
        ...Array.from(map.values()).sort((a, b) => b.cantidad - a.cantidad)
      )
    }
  }

  // ---- Tab 3: Caja chica (sesiones + movimientos del dia) ---------------
  const sesiones: CajaSesionRef[] = []
  const movimientos: CajaMovimientoRow[] = []
  {
    // Sesiones que estuvieron activas durante el dia. La tabla no tiene
    // `fecha_apertura` ni `fecha_cierre`: usamos `created_at` con alias
    // como apertura, y derivamos el cierre del ultimo movimiento 'Cierre'.
    // Filtro: aperturas antes del fin del dia. Para sesiones cerradas
    // antes del inicio del dia, las descartamos en post-procesamiento
    // usando `fecha_cierre` derivado.
    const { data: sesData, error: sesErr } = await supabase
      .from("caja_chica_sesiones")
      .select(
        "id, estado, saldo_inicial, saldo_final_real, usuario_apertura, usuario_cierre, fecha_apertura:created_at"
      )
      .eq("razon_social_id", tenantId)
      .lt("created_at", end)
      .order("created_at", { ascending: true })

    if (sesErr && isMissingRelation(sesErr)) {
      featurePending = true
    } else if (sesErr) {
      console.warn("[cierre-diario] error sesiones:", sesErr.message)
    } else {
      // Derivar fecha_cierre por sesion del ultimo movimiento 'Cierre'.
      const candidatos = (sesData || []) as Array<{
        id: number
        estado: string
        saldo_inicial: number | string
        saldo_final_real: number | string | null
        usuario_apertura: string | null
        usuario_cierre: string | null
        fecha_apertura: string
      }>
      const ids = candidatos.map((s) => s.id)
      const cierreById = new Map<number, string>()
      if (ids.length > 0) {
        const { data: cierres } = await supabase
          .from("caja_chica_movimientos")
          .select("sesion_id, fecha")
          .in("sesion_id", ids)
          .eq("tipo", "Cierre")
          .order("id", { ascending: false })
        for (const c of (cierres || []) as Array<{
          sesion_id: number
          fecha: string
        }>) {
          if (!cierreById.has(c.sesion_id)) cierreById.set(c.sesion_id, c.fecha)
        }
      }

      // Mapear y filtrar sesiones que NO se cerraron antes del inicio del dia.
      sesiones.push(
        ...candidatos
          .map((s) => ({
            id: s.id,
            estado: s.estado as "Abierta" | "Cerrada",
            saldo_inicial: Number(s.saldo_inicial || 0),
            saldo_final_real:
              s.saldo_final_real != null ? Number(s.saldo_final_real) : null,
            fecha_apertura: s.fecha_apertura,
            fecha_cierre: cierreById.get(s.id) ?? null,
            usuario_apertura: s.usuario_apertura,
            usuario_cierre: s.usuario_cierre,
          }))
          .filter((s) => !s.fecha_cierre || s.fecha_cierre >= start)
      )

      // Movimientos del dia, ordenados cronologicamente
      const { data: movData, error: movErr } = await supabase
        .from("caja_chica_movimientos")
        .select(`
          id, fecha, tipo, monto, concepto, saldo_resultante, cuenta_destino_id,
          cuentas_config:cuenta_destino_id (id, nombre)
        `)
        .eq("razon_social_id", tenantId)
        .gte("fecha", start)
        .lt("fecha", end)
        .order("fecha", { ascending: true })

      if (movErr && !isMissingRelation(movErr)) {
        console.warn("[cierre-diario] error movimientos:", movErr.message)
      } else if (movData) {
        for (const m of movData) {
          const cuenta: { id: number; nombre: string } | null =
            (Array.isArray(m.cuentas_config) ? m.cuentas_config[0] : m.cuentas_config) || null
          movimientos.push({
            id: m.id,
            fecha: m.fecha,
            tipo: m.tipo,
            monto: Number(m.monto || 0),
            concepto: m.concepto,
            saldo_resultante: Number(m.saldo_resultante || 0),
            cuenta_destino_id: m.cuenta_destino_id,
            cuenta_destino_nombre: cuenta?.nombre ?? null,
          })
        }
      }
    }
  }

  // ---- Tab 4: Pagos a gastos del dia ----------------------------------
  // No existe una tabla `gastos_pagos_detalle`. Reconstruimos los pagos
  // desde los movimientos en caja chica y cuenta bancaria filtrando por
  // ref_tipo='gasto' y la fecha del dia. Hacemos JOIN con `gastos` (y de
  // ahi a `proveedores` + `conceptos_gastos`) para enriquecer cada linea.
  const pagosGastos: PagoGastoRow[] = []
  let egresos_efectivo = 0
  let egresos_banco = 0

  // Acumulamos primero los movimientos crudos (efectivo y banco) y al final
  // hacemos UNA sola query a `gastos` por los IDs referenciados para
  // enriquecer concepto/proveedor. Asi evitamos depender de un embed
  // polimorfico en `ref_id` (que requeriria FK declarada en BD).
  type RawPago = {
    id: number
    fecha: string
    monto: number
    metodo: "Efectivo" | "Banco"
    cuenta_nombre: string | null
    concepto: string | null
    gasto_id: number
  }
  const rawPagos: RawPago[] = []

  // Pagos en EFECTIVO -> caja_chica_movimientos.
  {
    const { data, error } = await supabase
      .from("caja_chica_movimientos")
      .select("id, fecha, monto, concepto, ref_id, ref_tipo")
      .eq("razon_social_id", tenantId)
      .eq("ref_tipo", "gasto")
      .gte("fecha", start)
      .lt("fecha", end)
      .order("fecha", { ascending: true })

    if (error && isMissingRelation(error)) {
      featurePending = true
    } else if (error) {
      console.log("[cierre-diario] error pagos gasto efectivo:", error.message)
    } else {
      for (const m of data || []) {
        const monto = Math.abs(Number(m.monto || 0))
        if (monto <= 0 || m.ref_id == null) continue
        egresos_efectivo += monto
        rawPagos.push({
          id: m.id,
          fecha: m.fecha,
          monto,
          metodo: "Efectivo",
          cuenta_nombre: null,
          concepto: m.concepto ?? null,
          gasto_id: Number(m.ref_id),
        })
      }
    }
  }

  // Pagos en BANCO -> cuenta_movimientos (Egreso) con ref_tipo='gasto'.
  // Usamos embed solo a cuentas_config (FK real, sin polimorfismo).
  {
    const { data, error } = await supabase
      .from("cuenta_movimientos")
      .select(`
        id, fecha, monto, concepto, ref_id, ref_tipo, tipo, cuenta_id,
        cuentas_config:cuenta_id (id, nombre)
      `)
      .eq("razon_social_id", tenantId)
      .eq("ref_tipo", "gasto")
      .eq("tipo", "Egreso")
      .gte("fecha", start)
      .lt("fecha", end)
      .order("fecha", { ascending: true })

    if (error && isMissingRelation(error)) {
      featurePending = true
    } else if (error) {
      console.log("[cierre-diario] error pagos gasto banco:", error.message)
    } else {
      for (const m of data || []) {
        const monto = Number(m.monto || 0)
        if (monto <= 0 || m.ref_id == null) continue
        const cuenta = (Array.isArray(m.cuentas_config)
          ? m.cuentas_config[0]
          : m.cuentas_config) as { id: number; nombre: string } | null
        egresos_banco += monto
        rawPagos.push({
          id: m.id,
          fecha: m.fecha,
          monto,
          metodo: "Banco",
          cuenta_nombre: cuenta?.nombre ?? null,
          concepto: m.concepto ?? null,
          gasto_id: Number(m.ref_id),
        })
      }
    }
  }

  // Enriquecemos los pagos con concepto y proveedor en UNA query a `gastos`.
  // Si la query falla por permisos/RLS o por FK faltante, se degrada a null
  // sin romper el resto del cierre.
  const gastoMeta = new Map<
    number,
    { concepto_gasto: string | null; proveedor_nombre: string | null }
  >()
  if (rawPagos.length > 0) {
    const ids = Array.from(new Set(rawPagos.map((p) => p.gasto_id)))
    const { data: gastosData, error: gastosErr } = await supabase
      .from("gastos")
      .select(`
        id,
        conceptos_gastos:concepto_id (nombre),
        proveedores:proveedor_id (nombre)
      `)
      .in("id", ids)

    if (gastosErr) {
      console.log("[cierre-diario] no se pudo enriquecer gastos:", gastosErr.message)
    } else {
      for (const g of gastosData || []) {
        const c = Array.isArray(g.conceptos_gastos) ? g.conceptos_gastos[0] : g.conceptos_gastos
        const p = Array.isArray(g.proveedores) ? g.proveedores[0] : g.proveedores
        gastoMeta.set(Number(g.id), {
          concepto_gasto: (c as { nombre?: string | null } | null)?.nombre ?? null,
          proveedor_nombre: (p as { nombre?: string | null } | null)?.nombre ?? null,
        })
      }
    }
  }

  for (const p of rawPagos) {
    const meta = gastoMeta.get(p.gasto_id)
    pagosGastos.push({
      id: p.id,
      fecha_pago: p.fecha,
      monto: p.monto,
      metodo_pago: p.metodo,
      cuenta_nombre: p.cuenta_nombre,
      concepto: p.concepto,
      gasto_id: p.gasto_id,
      concepto_gasto: meta?.concepto_gasto ?? null,
      proveedor_nombre: meta?.proveedor_nombre ?? null,
    })
  }

  // Orden cronologico mezclando efectivo y banco.
  pagosGastos.sort(
    (a, b) => new Date(a.fecha_pago).getTime() - new Date(b.fecha_pago).getTime()
  )

  resumen.egresos_gastos_efectivo = +egresos_efectivo.toFixed(2)
  resumen.egresos_gastos_banco = +egresos_banco.toFixed(2)

  // ---- Total de Egresos del Dia (caja chica) ---------------------------
  // Suma absoluta de cualquier movimiento `Salida` registrado en el dia.
  // Esto incluye salidas vinculadas a un gasto formal Y salidas manuales
  // (caja menor, gastos express, etc.). El monto se almacena negativo,
  // por eso usamos Math.abs.
  let total_egresos_caja = 0
  {
    const { data, error } = await supabase
      .from("caja_chica_movimientos")
      .select("monto")
      .eq("razon_social_id", tenantId)
      .eq("tipo", "Salida")
      .gte("fecha", start)
      .lt("fecha", end)

    if (error && isMissingRelation(error)) {
      featurePending = true
    } else if (error) {
      console.warn("[cierre-diario] error salidas caja:", error.message)
    } else {
      for (const m of data || []) {
        total_egresos_caja += Math.abs(Number(m.monto || 0))
      }
    }
  }
  resumen.total_egresos_caja = +total_egresos_caja.toFixed(2)

  // ---- Ingresos en Efectivo (FUENTE OFICIAL: caja_chica_movimientos) ----
  // OVERRIDE: ignoramos lo que haya calculado la vista o el fallback de
  // ventas_pagos_detalle para este KPI. La fuente de verdad son los
  // movimientos de caja chica filtrados por:
  //   - razon_social_id = tenant
  //   - created_at en el rango [start, end) del dia consultado
  //   - tipo IN ('Ingreso_Venta','Ingreso_Manual')
  //
  // Separamos conceptualmente:
  //   - 'Ingreso_Venta'  -> resumen.ingresos_efectivo (cobros de ventas)
  //   - 'Ingreso_Manual' -> resumen.ingresos_efectivo_manual (inyecciones)
  // Ademas exponemos el detalle (hora, concepto, cajero, monto) para la
  // tabla desplegable en la UI.
  const detalleEfectivo: IngresoEfectivoDetalle[] = []
  {
    const { data, error } = await supabase
      .from("caja_chica_movimientos")
      .select(
        "id, created_at, tipo, monto, concepto, usuario, ref_tipo, ref_id"
      )
      .eq("razon_social_id", tenantId)
      .in("tipo", ["Ingreso_Venta", "Ingreso_Manual"])
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at", { ascending: true })

    if (error && isMissingRelation(error)) {
      featurePending = true
    } else if (error) {
      console.warn("[cierre-diario] error ingresos efectivo:", error.message)
    } else {
      let totalVenta = 0
      let totalManual = 0
      for (const m of data || []) {
        // El monto se almacena positivo para ingresos por convencion del
        // schema. Usamos Math.abs por seguridad ante datos legacy.
        const monto = Math.abs(Number(m.monto || 0))
        const tipo = m.tipo as "Ingreso_Venta" | "Ingreso_Manual"
        if (tipo === "Ingreso_Venta") totalVenta += monto
        else if (tipo === "Ingreso_Manual") totalManual += monto

        detalleEfectivo.push({
          id: Number(m.id),
          fecha: m.created_at,
          tipo,
          monto,
          concepto: m.concepto ?? null,
          cajero: m.usuario ?? null,
          ref_tipo: m.ref_tipo ?? null,
          ref_id: m.ref_id != null ? Number(m.ref_id) : null,
        })
      }
      // Override absoluto: este es el valor correcto.
      resumen.ingresos_efectivo = +totalVenta.toFixed(2)
      resumen.ingresos_efectivo_manual = +totalManual.toFixed(2)
    }
  }

  // ---- Gastos del Dia (tabla `gastos`, filtrando por `fecha_gasto`) -----
  // Resumen de QUE se gasto hoy, sin importar como se pago. Util como
  // contexto de los pagos. La tabla `gastos` puede no tener
  // razon_social_id (segun el script 012 historico); intentamos filtrar y
  // si la columna no existe, degradamos a un select sin ese filtro.
  const gastosDelDia: GastoDelDia[] = []
  {
    let q = supabase
      .from("gastos")
      .select(`
        id,
        fecha_gasto,
        monto,
        metodo_pago,
        descripcion,
        razon_social_id,
        conceptos_gastos:concepto_id (nombre)
      `)
      .eq("fecha_gasto", fechaISO)
      .order("id", { ascending: true })

    // Defensa multi-tenant: si la columna existe en BD, filtramos por ella.
    // Si no existe, PostgREST devolvera error; lo ignoramos en ese caso.
    q = q.eq("razon_social_id", tenantId)

    const { data, error } = await q

    if (error) {
      // Re-intentamos sin el filtro de razon_social_id si la columna no existe.
      // En ese caso confiamos solo en RLS para aislamiento.
      if (/column.*razon_social_id.*does not exist/i.test(error.message || "")) {
        const retry = await supabase
          .from("gastos")
          .select(`
            id,
            fecha_gasto,
            monto,
            metodo_pago,
            descripcion,
            conceptos_gastos:concepto_id (nombre)
          `)
          .eq("fecha_gasto", fechaISO)
          .order("id", { ascending: true })
        if (!retry.error) {
          for (const g of retry.data || []) {
            const c = Array.isArray(g.conceptos_gastos)
              ? g.conceptos_gastos[0]
              : g.conceptos_gastos
            gastosDelDia.push({
              id: Number(g.id),
              fecha_gasto: g.fecha_gasto,
              monto: Number(g.monto || 0),
              metodo_pago: g.metodo_pago,
              descripcion: g.descripcion ?? null,
              concepto_nombre:
                (c as { nombre?: string | null } | null)?.nombre ?? null,
            })
          }
        } else if (!isMissingRelation(retry.error)) {
          console.warn("[cierre-diario] error gastos del dia:", retry.error.message)
        }
      } else if (!isMissingRelation(error)) {
        console.warn("[cierre-diario] error gastos del dia:", error.message)
      }
    } else {
      for (const g of data || []) {
        const c = Array.isArray(g.conceptos_gastos)
          ? g.conceptos_gastos[0]
          : g.conceptos_gastos
        gastosDelDia.push({
          id: Number(g.id),
          fecha_gasto: g.fecha_gasto,
          monto: Number(g.monto || 0),
          metodo_pago: g.metodo_pago,
          descripcion: g.descripcion ?? null,
          concepto_nombre:
            (c as { nombre?: string | null } | null)?.nombre ?? null,
        })
      }
    }
  }

  // ---- Devoluciones del dia (notas de credito, script 020) --------------
  // Se listan aparte del flujo de caja/banco para que el corte muestre QUE
  // se devolvio, ademas del dinero que salio. Si la tabla no existe, se
  // degrada en silencio (sin devoluciones).
  const devoluciones: DevolucionDelDia[] = []
  let totalDevoluciones = 0
  {
    const { data, error } = await supabase
      .from("devoluciones_encabezado")
      .select("id, numero_devolucion, monto_total, destino_reembolso, motivo, ventas_encabezado:venta_id (numero_factura)")
      .eq("razon_social_id", tenantId)
      .gte("fecha", start)
      .lt("fecha", end)
      .order("id", { ascending: true })

    if (error) {
      if (!isMissingRelation(error)) {
        console.warn("[cierre-diario] error devoluciones del dia:", error.message)
      }
    } else {
      for (const d of data || []) {
        const venta = Array.isArray(d.ventas_encabezado) ? d.ventas_encabezado[0] : d.ventas_encabezado
        const monto = Number(d.monto_total || 0)
        totalDevoluciones += monto
        devoluciones.push({
          id: Number(d.id),
          numero_devolucion: d.numero_devolucion ?? null,
          monto_total: monto,
          destino_reembolso: d.destino_reembolso || "",
          motivo: d.motivo ?? null,
          numero_factura: (venta as { numero_factura?: string } | null)?.numero_factura ?? null,
        })
      }
      totalDevoluciones = +totalDevoluciones.toFixed(2)
    }
  }

  // ---- Desglose del total vendido por metodo de cobro -------------------
  // Reconstruye, desde `ventas_pagos_detalle` de las ventas del dia, cuanto
  // se cobro por efectivo / banco / credito y cuanto se fue en comisiones.
  // Objetivo UX: dejar EXPLICITO que el total vendido no se "pierde" al
  // cerrar — solo se reparte entre metodos, y el banco entra neto.
  // `sinDesglose` captura ventas sin renglon de pago para que cuadre.
  const desgloseMetodos: DesgloseVentasMetodo = {
    totalVentas: +Number(resumen.total_ventas || 0).toFixed(2),
    efectivo: 0,
    bancoBruto: 0,
    comisiones: 0,
    bancoNeto: 0,
    credito: 0,
    otros: 0,
    sinDesglose: 0,
  }
  if (ventaIdsDelDia.length > 0) {
    const { data: pagosDia, error: pagosDiaErr } = await supabase
      .from("ventas_pagos_detalle")
      .select("venta_id, metodo_pago, monto_bruto, monto_neto")
      .in("venta_id", ventaIdsDelDia)

    if (pagosDiaErr && isMissingRelation(pagosDiaErr)) {
      featurePending = true
    } else if (pagosDiaErr) {
      console.warn("[cierre-diario] error desglose metodos:", pagosDiaErr.message)
    } else {
      let brutoCubierto = 0
      for (const p of pagosDia || []) {
        const bruto = Number(p.monto_bruto || 0)
        const neto = Number(p.monto_neto ?? p.monto_bruto ?? 0)
        brutoCubierto += bruto
        if (p.metodo_pago === "Efectivo") {
          desgloseMetodos.efectivo += bruto
        } else if (p.metodo_pago === "Banco" || p.metodo_pago === "Link_Pago") {
          desgloseMetodos.bancoBruto += bruto
          desgloseMetodos.comisiones += bruto - neto
        } else if (p.metodo_pago === "Credito") {
          desgloseMetodos.credito += bruto
        } else {
          desgloseMetodos.otros += bruto
        }
      }
      // Ventas del dia sin ningun renglon de pago: la diferencia entra en
      // `sinDesglose` para que efectivo+banco+credito+otros+sinDesglose
      // cuadre contra totalVentas. Nunca negativo (por redondeos/abonos).
      desgloseMetodos.sinDesglose = Math.max(
        0,
        +(desgloseMetodos.totalVentas - brutoCubierto).toFixed(2)
      )
      desgloseMetodos.efectivo = +desgloseMetodos.efectivo.toFixed(2)
      desgloseMetodos.bancoBruto = +desgloseMetodos.bancoBruto.toFixed(2)
      desgloseMetodos.comisiones = +desgloseMetodos.comisiones.toFixed(2)
      desgloseMetodos.bancoNeto = +(
        desgloseMetodos.bancoBruto - desgloseMetodos.comisiones
      ).toFixed(2)
      desgloseMetodos.credito = +desgloseMetodos.credito.toFixed(2)
      desgloseMetodos.otros = +desgloseMetodos.otros.toFixed(2)
    }
  }

  return {
    data: {
      resumen,
      bancos,
      productos,
      caja: { sesiones, movimientos },
      pagosGastos,
      gastosDelDia,
      detalleEfectivo,
      devoluciones,
      totalDevoluciones,
      desgloseMetodos,
      featurePending,
    },
    error: null,
  }
}

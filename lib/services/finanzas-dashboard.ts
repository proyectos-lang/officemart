import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp } from "@/lib/services/tenant-stamp"
import { getCuentas } from "@/lib/services/cuentas"
import { getSaldoActualSesionAbierta } from "@/lib/services/caja-chica"
import { getCuentasPorCobrar } from "@/lib/services/ventas"
import { getCuentasPorPagar } from "@/lib/services/gastos"
import { getCuentasPorPagarCompras } from "@/lib/services/compras-recepciones"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { getEstadoResultadosMensual } from "@/lib/services/estado-resultados"

// ==================== TIPOS ====================

export interface SaldoCuenta {
  cuenta_id: number
  nombre: string
  tipo: string
  saldo: number
}

export interface FinanzasResumen {
  /** Saldo de cada cuenta bancaria activa. */
  cuentas: SaldoCuenta[]
  /** Saldo de la caja chica (sesion abierta), 0 si no hay sesion. */
  saldoCaja: number
  /** Suma de saldos de todas las cuentas bancarias. */
  totalBancos: number
  /** Cuentas por cobrar pendientes (suma de saldo_pendiente). */
  cxcPendiente: number
  /** Cuentas por pagar pendientes (deuda viva). */
  cxpPendiente: number
  /** Ventas del mes en curso (neto de devoluciones cuando aplique). */
  ventasDelMes: number
  /** Balance de bancos = bancos + caja + CxC - CxP. */
  balanceBancos: number
}

export interface FlujoMes {
  mes: number
  mes_nombre: string
  entradas: number
  salidas: number
  neto: number
}

const MESES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
]

// ==================== RESUMEN (KPIs) ====================

/**
 * Compone los KPIs del dashboard de finanzas reutilizando los servicios
 * existentes. Cada uno ya aplica aislamiento multi-tenant por razon_social_id.
 */
export async function getFinanzasResumen(): Promise<{ data: FinanzasResumen; error: string | null }> {
  const vacio: FinanzasResumen = {
    cuentas: [],
    saldoCaja: 0,
    totalBancos: 0,
    cxcPendiente: 0,
    cxpPendiente: 0,
    ventasDelMes: 0,
    balanceBancos: 0,
  }

  const ahora = new Date()
  const [cuentasRes, saldoCaja, cxcRes, cxpRes, cxpComprasRes, erRes] = await Promise.all([
    getCuentas(),
    getSaldoActualSesionAbierta().catch(() => 0),
    getCuentasPorCobrar(),
    getCuentasPorPagar(),
    // CxP por orden de compra (officemart-008); 0 si el script no está aplicado.
    getCuentasPorPagarCompras(getHondurasTodayISODate()).catch(() => ({ totalDeuda: 0 })),
    getEstadoResultadosMensual(ahora.getFullYear(), ahora.getMonth() + 1),
  ])

  const cuentas: SaldoCuenta[] = (cuentasRes.data || [])
    .filter((c) => c.activo !== false)
    .map((c) => ({
      cuenta_id: c.id!,
      nombre: c.nombre,
      tipo: c.tipo,
      saldo: Number(c.saldo || 0),
    }))

  const totalBancos = cuentas.reduce((a, c) => a + c.saldo, 0)
  const cxcPendiente = (cxcRes.data || []).reduce((a, c) => a + Number(c.saldo_pendiente || 0), 0)
  const cxpPendiente = Number(cxpRes.totalDeuda || 0) + Number(cxpComprasRes.totalDeuda || 0)
  const ventasDelMes = Number(erRes.data?.ventas_totales || 0)

  const data: FinanzasResumen = {
    cuentas,
    saldoCaja: Number(saldoCaja || 0),
    totalBancos: +totalBancos.toFixed(2),
    cxcPendiente: +cxcPendiente.toFixed(2),
    cxpPendiente: +cxpPendiente.toFixed(2),
    ventasDelMes: +ventasDelMes.toFixed(2),
    // Balance de bancos = bancos + caja + CxC - CxP.
    balanceBancos: +(totalBancos + Number(saldoCaja || 0) + cxcPendiente - cxpPendiente).toFixed(2),
  }

  return { data, error: null }
}

// ==================== FLUJO DE CAJA MENSUAL ====================

/**
 * Flujo de caja REAL por mes de un año: dinero efectivamente entrado y salido
 * del negocio, agregando `cuenta_movimientos` (bancos) + `caja_chica_movimientos`
 * (efectivo). Excluye transferencias internas (caja<->banco, banco<->banco) y
 * los asientos de Apertura/Cierre de caja, que no representan flujo real.
 */
export async function getFlujoCajaMensual(
  anio: number
): Promise<{ data: FlujoMes[]; error: string | null }> {
  const base: FlujoMes[] = MESES.map((n, i) => ({
    mes: i + 1,
    mes_nombre: n,
    entradas: 0,
    salidas: 0,
    neto: 0,
  }))

  if (!isSupabaseConfigured()) return { data: base, error: null }
  const supabase = createClient()
  if (!supabase) return { data: base, error: "Cliente no disponible" }

  const stamp = await getTenantStamp(supabase)
  if (stamp.razon_social_id == null) return { data: base, error: null }
  const tenantId = stamp.razon_social_id

  const desde = `${anio}-01-01T00:00:00`
  const hasta = `${anio}-12-31T23:59:59`

  // --- Bancos: cuenta_movimientos (excluye transferencias internas) ---
  const { data: bancoMovs } = await supabase
    .from("cuenta_movimientos")
    .select("fecha, tipo, monto, ref_tipo")
    .eq("razon_social_id", tenantId)
    .gte("fecha", desde)
    .lte("fecha", hasta)

  for (const m of bancoMovs || []) {
    const refTipo = (m.ref_tipo || "") as string
    // Transferencias internas no son flujo real del negocio.
    if (refTipo === "transferencia" || refTipo === "caja_chica_mov") continue
    const mesIdx = new Date(m.fecha).getMonth()
    const monto = Number(m.monto || 0)
    if (m.tipo === "Ingreso") base[mesIdx].entradas += monto
    else base[mesIdx].salidas += monto
  }

  // --- Caja chica: caja_chica_movimientos (solo flujo real) ---
  const { data: cajaMovs } = await supabase
    .from("caja_chica_movimientos")
    .select("fecha, created_at, tipo, monto")
    .eq("razon_social_id", tenantId)
    .gte("created_at", desde)
    .lte("created_at", hasta)

  for (const m of cajaMovs || []) {
    const tipo = m.tipo as string
    // Excluye Apertura, Cierre y Transferencia_Banco (interno).
    if (tipo === "Ingreso_Manual" || tipo === "Ingreso_Venta") {
      const mesIdx = new Date(m.created_at || m.fecha).getMonth()
      base[mesIdx].entradas += Math.abs(Number(m.monto || 0))
    } else if (tipo === "Salida") {
      const mesIdx = new Date(m.created_at || m.fecha).getMonth()
      base[mesIdx].salidas += Math.abs(Number(m.monto || 0))
    }
  }

  for (const row of base) {
    row.entradas = +row.entradas.toFixed(2)
    row.salidas = +row.salidas.toFixed(2)
    row.neto = +(row.entradas - row.salidas).toFixed(2)
  }

  return { data: base, error: null }
}

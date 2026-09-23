import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getCuentas } from "@/lib/services/cuentas"
import { getSaldoActualSesionAbierta } from "@/lib/services/caja-chica"
import { getCuentasPorCobrar } from "@/lib/services/ventas"
import { getCuentasPorPagar } from "@/lib/services/gastos"
import { getCuentasPorPagarCompras } from "@/lib/services/compras-recepciones"
import { getValoracionInventarioExtendida } from "@/lib/services/inventario"
import { getValoracionMateriales } from "@/lib/services/produccion-materiales"
import { getValoracionConsignacion, getConsignacionPendiente } from "@/lib/services/consignacion"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"

/**
 * Balance operativo (Fase 4.6): foto de gestión a hoy, SIN partida doble.
 *   Activos  = caja + bancos + CxC vigentes + inventario propio (productos) +
 *              materiales + anticipos a proveedores (OC pagadas sin recibir).
 *   Pasivos  = CxP gastos + CxP órdenes de compra + comisiones aprobadas sin
 *              pagar + consignación por liquidar.
 *   Patrimonio operativo = activos − pasivos.
 * Cada partida es best-effort: si su tabla no existe, va en 0 con nota.
 */

export interface PartidaBalance {
  clave: string
  nombre: string
  monto: number
  detalle?: string | null
  /** Partida no disponible (script pendiente / error): se muestra en 0 con aviso. */
  nota?: string | null
}

export interface BalanceOperativo {
  fecha: string
  activos: PartidaBalance[]
  pasivos: PartidaBalance[]
  totalActivos: number
  totalPasivos: number
  patrimonio: number
  /** Liquidez inmediata = caja + bancos − CxP exigibles (gastos + OC). */
  liquidez: number
  /** Capital de trabajo = activos corrientes − pasivos corrientes (todo lo del balance). */
  capitalTrabajo: number
}

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

/** Arma totales e indicadores a partir de las partidas (pura). */
export function armarBalance(fecha: string, activos: PartidaBalance[], pasivos: PartidaBalance[]): BalanceOperativo {
  const totalActivos = r2(activos.reduce((a, p) => a + (Number(p.monto) || 0), 0))
  const totalPasivos = r2(pasivos.reduce((a, p) => a + (Number(p.monto) || 0), 0))
  const monto = (lista: PartidaBalance[], clave: string) => Number(lista.find((p) => p.clave === clave)?.monto || 0)
  const liquidez = r2(monto(activos, "caja") + monto(activos, "bancos") - monto(pasivos, "cxp_gastos") - monto(pasivos, "cxp_compras"))
  return {
    fecha,
    activos: activos.map((p) => ({ ...p, monto: r2(p.monto) })),
    pasivos: pasivos.map((p) => ({ ...p, monto: r2(p.monto) })),
    totalActivos,
    totalPasivos,
    patrimonio: r2(totalActivos - totalPasivos),
    liquidez,
    capitalTrabajo: r2(totalActivos - totalPasivos),
  }
}

export async function getBalanceOperativo(): Promise<{ data: BalanceOperativo | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: null }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const hoy = getHondurasTodayISODate()
  try {
    const [cuentasRes, saldoCaja, cxcRes, cxpRes, cxpComprasRes, valRes, matRes, consigVal, consigPend, anticipos, comisiones] = await Promise.all([
      getCuentas(),
      getSaldoActualSesionAbierta().catch(() => 0),
      getCuentasPorCobrar(),
      getCuentasPorPagar(),
      getCuentasPorPagarCompras(hoy).catch(() => ({ totalDeuda: 0, pendiente: true, data: [], error: null })),
      getValoracionInventarioExtendida(),
      getValoracionMateriales().catch(() => ({ data: [], error: "pendiente" })),
      getValoracionConsignacion().catch(() => ({ data: null, error: "pendiente" })),
      getConsignacionPendiente().catch(() => ({ data: [], locs: [], error: null, pendiente: true })),
      // Anticipos: OC con pagos vigentes por encima de lo recibido.
      supabase.from("compras_encabezado").select("id, monto_pagado, total_recibido_local, estado").neq("estado", "Cancelada").gt("monto_pagado", 0),
      // Comisiones aprobadas y no pagadas.
      supabase.from("comisiones_liquidaciones").select("total").eq("estado", "Aprobada"),
    ])

    const bancos = (cuentasRes.data || []).filter((c) => c.activo !== false).reduce((a, c) => a + Number(c.saldo || 0), 0)
    const cxc = (cxcRes.data || []).reduce((a, c) => a + Number(c.saldo_pendiente || 0), 0)
    const invTotal = (valRes.data || []).reduce((a, p) => a + Number(p.valor_costo || 0), 0)
    const consignado = consigVal.data?.consignado ?? 0
    const materiales = (matRes.data || []).reduce((a, m) => a + Number(m.valor_total || 0), 0)
    const anticipoNeto = ((anticipos.data || []) as { monto_pagado: number | null; total_recibido_local: number | null }[]).reduce((a, o) => a + Math.max(0, Number(o.monto_pagado || 0) - Number(o.total_recibido_local || 0)), 0)
    const comisionesPend = ((comisiones.data || []) as { total: number }[]).reduce((a, c) => a + Number(c.total || 0), 0)
    const consigPorLiquidar = (consigPend.data || []).reduce((a, g) => a + Number(g.total || 0), 0)

    const activos: PartidaBalance[] = [
      { clave: "caja", nombre: "Caja chica (sesión abierta)", monto: Number(saldoCaja || 0) },
      { clave: "bancos", nombre: "Bancos", monto: bancos, detalle: (cuentasRes.data || []).filter((c) => c.activo !== false).map((c) => `${c.nombre}: ${Number(c.saldo || 0).toFixed(2)}`).join(" · ") || null },
      { clave: "cxc", nombre: "Cuentas por cobrar (facturas vigentes)", monto: cxc, detalle: `${(cxcRes.data || []).length} factura(s) con saldo` },
      { clave: "inventario", nombre: "Inventario propio (productos, a costo)", monto: Math.max(0, invTotal - consignado), detalle: consignado > 0 ? `Excluye ${consignado.toFixed(2)} consignado (no es tuyo)` : null, nota: valRes.error || null },
      { clave: "materiales", nombre: "Materiales de producción (a costo)", monto: materiales, nota: matRes.error && matRes.error !== "pendiente" ? matRes.error : null },
      { clave: "anticipos", nombre: "Anticipos a proveedores (OC pagadas sin recibir)", monto: anticipoNeto, nota: anticipos.error ? "Requiere officemart-008" : null },
    ]
    const pasivos: PartidaBalance[] = [
      { clave: "cxp_gastos", nombre: "Cuentas por pagar (gastos / facturas)", monto: Number(cxpRes.totalDeuda || 0), detalle: `${(cxpRes.data || []).length} documento(s)` },
      { clave: "cxp_compras", nombre: "Cuentas por pagar (órdenes de compra a crédito)", monto: Number(cxpComprasRes.totalDeuda || 0), nota: cxpComprasRes.pendiente ? "Requiere officemart-008" : null },
      { clave: "comisiones", nombre: "Comisiones aprobadas por pagar", monto: comisionesPend, nota: comisiones.error ? "Requiere officemart-011" : null },
      { clave: "consignacion", nombre: "Consignación por liquidar a proveedores", monto: consigPorLiquidar, nota: consigPend.pendiente ? "Requiere officemart-012" : null },
    ]
    return { data: armarBalance(hoy, activos, pasivos), error: null }
  } catch (err) {
    console.error("[balance] get:", err)
    return { data: null, error: "Error de conexión" }
  }
}

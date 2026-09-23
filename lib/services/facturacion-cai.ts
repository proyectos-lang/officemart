import { createClient } from '@/lib/supabase/client'
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from '@/lib/services/tenant-stamp'
import { montoEnLetrasLempiras } from '@/lib/utils/numero-a-letras'

/**
 * Facturación CAI (comprobantes fiscales del SAR, Honduras) — FASE 1.
 *
 * Guarda la configuracion fiscal por empresa y tipo de documento (tabla
 * `facturacion_cai_config`, script 060): CAI, rango autorizado, correlativo,
 * establecimiento/punto de emision, fecha limite e imprenta. Esta fase solo
 * captura los datos; los imprimibles se enganchan en la Fase 2.
 *
 * Multi-tenant: toda query filtra por RLS (`app_current_tenant()`) y todo insert
 * lleva `getTenantStamp`. Degrada sin romper si el script 060 no se ha corrido.
 */

/** Tipos de documento fiscal del SAR soportados. */
export const TIPOS_DOCUMENTO_CAI = [
  { codigo: '01', label: 'Factura' },
  { codigo: '06', label: 'Nota de Crédito' },
  { codigo: '07', label: 'Nota de Débito' },
] as const

export type TipoDocumentoCai = (typeof TIPOS_DOCUMENTO_CAI)[number]['codigo']

export function tipoDocumentoLabel(codigo: string): string {
  return TIPOS_DOCUMENTO_CAI.find((t) => t.codigo === codigo)?.label ?? codigo
}

export interface ConfigCai {
  id?: number
  /** Punto de facturación dueño de la config (0 = empresa sin puntos; script officemart-004). */
  punto_facturacion_id?: number
  tipo_documento: string
  cai: string
  establecimiento: string
  punto_emision: string
  rango_inicial: number
  rango_final: number
  correlativo_actual: number
  fecha_limite_emision: string | null // YYYY-MM-DD
  imprenta_nombre: string
  imprenta_rtn: string
  imprenta_registro: string
  activo: boolean
}

/** Config vacia (valores por defecto) para un tipo de documento. */
export function nuevaConfigCai(tipo_documento: string = '01'): ConfigCai {
  return {
    tipo_documento,
    cai: '',
    establecimiento: '000',
    punto_emision: '001',
    rango_inicial: 1,
    rango_final: 0,
    correlativo_actual: 1,
    fecha_limite_emision: null,
    imprenta_nombre: '',
    imprenta_rtn: '',
    imprenta_registro: '',
    activo: true,
  }
}

/**
 * Formatea el correlativo fiscal visible: ESTAB-PUNTO-TIPO-NNNNNNNN.
 * p.ej. formatearCorrelativoCai('000','001','01', 3) -> '000-001-01-00000003'.
 * Funcion pura (se reutiliza en la Fase 2 para el imprimible).
 */
export function formatearCorrelativoCai(
  establecimiento: string,
  puntoEmision: string,
  tipoDocumento: string,
  numero: number
): string {
  const estab = (establecimiento || '').padStart(3, '0').slice(-3)
  const punto = (puntoEmision || '').padStart(3, '0').slice(-3)
  const tipo = (tipoDocumento || '').padStart(2, '0').slice(-2)
  const corr = String(Math.max(0, Math.floor(numero || 0))).padStart(8, '0')
  return `${estab}-${punto}-${tipo}-${corr}`
}

/** Cuantos folios quedan dentro del rango autorizado (>=0). */
export function foliosRestantes(c: Pick<ConfigCai, 'rango_final' | 'correlativo_actual'>): number {
  return Math.max(0, (c.rango_final || 0) - (c.correlativo_actual || 0) + 1)
}

/** true si la fecha limite ya paso (respecto a la fecha local dada, YYYY-MM-DD). */
export function fechaLimiteVencida(fechaLimite: string | null, hoyISO: string): boolean {
  if (!fechaLimite) return false
  return fechaLimite < hoyISO
}

function normalizarFila(r: Record<string, unknown>): ConfigCai {
  return {
    id: (r.id as number) ?? undefined,
    punto_facturacion_id: Number(r.punto_facturacion_id ?? 0),
    tipo_documento: String(r.tipo_documento ?? '01'),
    cai: String(r.cai ?? ''),
    establecimiento: String(r.establecimiento ?? '000'),
    punto_emision: String(r.punto_emision ?? '001'),
    rango_inicial: Number(r.rango_inicial ?? 1),
    rango_final: Number(r.rango_final ?? 0),
    correlativo_actual: Number(r.correlativo_actual ?? 1),
    fecha_limite_emision: (r.fecha_limite_emision as string) ?? null,
    imprenta_nombre: String(r.imprenta_nombre ?? ''),
    imprenta_rtn: String(r.imprenta_rtn ?? ''),
    imprenta_registro: String(r.imprenta_registro ?? ''),
    activo: r.activo === undefined ? true : Boolean(r.activo),
  }
}

/** Tabla ausente (42P01) o fuera del schema cache de PostgREST (PGRST205). */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || '').toLowerCase()
  return err.code === '42P01' || err.code === 'PGRST205' || msg.includes('schema cache')
}

/** RPC ausente (script pendiente). */
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || '').toLowerCase()
  return err.code === '42883' || err.code === 'PGRST202' || msg.includes('could not find the function')
}

/**
 * Trae las configuraciones CAI del tenant para un punto de facturación (una
 * por tipo de documento). Desde el script officemart-004 la fuente es
 * `facturacion_cai_puntos` (punto 0 = empresa sin puntos); si esa tabla no
 * existe se lee la tabla clásica `facturacion_cai_config` (solo punto 0).
 * Degrada a [] si ninguna existe (script 060 sin correr).
 */
export async function getConfigsCai(puntoId: number = 0): Promise<{ data: ConfigCai[]; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente de Supabase no disponible' }
  try {
    const porPunto = await supabase
      .from('facturacion_cai_puntos')
      .select('*')
      .eq('punto_facturacion_id', puntoId || 0)
      .order('tipo_documento', { ascending: true })
    if (!porPunto.error) return { data: (porPunto.data || []).map(normalizarFila), error: null }
    if (!isMissingTable(porPunto.error)) return { data: [], error: porPunto.error.message }
    // Tabla por punto ausente: la config clásica solo aplica al punto 0.
    if ((puntoId || 0) !== 0) return { data: [], error: null }
    const { data, error } = await supabase
      .from('facturacion_cai_config')
      .select('*')
      .order('tipo_documento', { ascending: true })
    if (error) {
      // Tabla ausente u otra falla: no rompe la UI.
      if (isMissingTable(error)) return { data: [], error: null }
      return { data: [], error: error.message }
    }
    return { data: (data || []).map(normalizarFila), error: null }
  } catch (err) {
    console.error('[facturacion-cai] getConfigsCai:', err)
    return { data: [], error: 'Error de conexión' }
  }
}

/**
 * Crea o actualiza la config CAI de un tipo de documento del tenant para un
 * punto de facturación. Upsert por (razon_social_id, punto, tipo_documento) en
 * `facturacion_cai_puntos`; si esa tabla no existe (officemart-004 pendiente)
 * cae a `facturacion_cai_config` (solo punto 0).
 */
export async function saveConfigCai(
  cfg: ConfigCai,
  puntoId: number = cfg.punto_facturacion_id ?? 0
): Promise<{ data: ConfigCai | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente de Supabase no disponible' }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }

  // Validaciones minimas de coherencia del rango/correlativo.
  if (cfg.rango_final > 0 && cfg.rango_final < cfg.rango_inicial) {
    return { data: null, error: 'El rango final no puede ser menor que el inicial.' }
  }
  if (cfg.correlativo_actual < cfg.rango_inicial) {
    return { data: null, error: 'El correlativo actual no puede ser menor que el rango inicial.' }
  }
  if (cfg.rango_final > 0 && cfg.correlativo_actual > cfg.rango_final + 1) {
    return { data: null, error: 'El correlativo actual está fuera del rango autorizado.' }
  }

  const fila = {
    razon_social_id: stamp.razon_social_id,
    tipo_documento: cfg.tipo_documento,
    cai: cfg.cai.trim() || null,
    establecimiento: (cfg.establecimiento || '000').trim(),
    punto_emision: (cfg.punto_emision || '001').trim(),
    rango_inicial: Math.max(1, Math.floor(cfg.rango_inicial || 1)),
    rango_final: Math.max(0, Math.floor(cfg.rango_final || 0)),
    correlativo_actual: Math.max(1, Math.floor(cfg.correlativo_actual || 1)),
    fecha_limite_emision: cfg.fecha_limite_emision || null,
    imprenta_nombre: cfg.imprenta_nombre.trim() || null,
    imprenta_rtn: cfg.imprenta_rtn.trim() || null,
    imprenta_registro: cfg.imprenta_registro.trim() || null,
    activo: cfg.activo,
    usuario: stamp.usuario,
    updated_at: new Date().toISOString(),
  }

  try {
    const porPunto = await supabase
      .from('facturacion_cai_puntos')
      .upsert(
        { ...fila, punto_facturacion_id: puntoId || 0 },
        { onConflict: 'razon_social_id,punto_facturacion_id,tipo_documento' }
      )
      .select('*')
      .single()
    if (!porPunto.error) return { data: porPunto.data ? normalizarFila(porPunto.data) : null, error: null }
    if (!isMissingTable(porPunto.error)) return { data: null, error: porPunto.error.message }
    if ((puntoId || 0) !== 0) {
      return { data: null, error: 'La configuración CAI por punto requiere el script officemart-004.' }
    }
    const { data, error } = await supabase
      .from('facturacion_cai_config')
      .upsert(fila, { onConflict: 'razon_social_id,tipo_documento' })
      .select('*')
      .single()
    if (error) {
      if (isMissingTable(error)) {
        return { data: null, error: 'La tabla de Facturación CAI no existe aún. Corre el script 060.' }
      }
      return { data: null, error: error.message }
    }
    return { data: data ? normalizarFila(data) : null, error: null }
  } catch (err) {
    console.error('[facturacion-cai] saveConfigCai:', err)
    return { data: null, error: 'Error de conexión' }
  }
}

/** Correlativo fiscal ya emitido (consumido) para una factura. */
export interface CorrelativoCaiEmitido {
  numero: string // 'ESTAB-PUNTO-TIPO-NNNNNNNN'
  correlativo: number
  establecimiento: string
  punto_emision: string
  tipo_documento: string
  cai: string | null
  /** Datos de la autorización (solo los devuelve el RPC v2, script officemart-004). */
  rango_inicial?: number | null
  rango_final?: number | null
  fecha_limite_emision?: string | null
  imprenta_nombre?: string | null
  imprenta_rtn?: string | null
  imprenta_registro?: string | null
}

function mapCorrelativoFila(fila: Record<string, unknown>, tipoDocumento: string): CorrelativoCaiEmitido {
  const num = (v: unknown) => (v == null ? null : Number(v))
  const txt = (v: unknown) => (v == null ? null : String(v))
  return {
    numero: String(fila.numero),
    correlativo: Number(fila.correlativo),
    establecimiento: String(fila.establecimiento ?? '000'),
    punto_emision: String(fila.punto_emision ?? '001'),
    tipo_documento: String(fila.tipo_documento ?? tipoDocumento),
    cai: txt(fila.cai),
    rango_inicial: num(fila.rango_inicial),
    rango_final: num(fila.rango_final),
    fecha_limite_emision: txt(fila.fecha_limite_emision),
    imprenta_nombre: txt(fila.imprenta_nombre),
    imprenta_rtn: txt(fila.imprenta_rtn),
    imprenta_registro: txt(fila.imprenta_registro),
  }
}

/**
 * Emite (CONSUME) el siguiente correlativo fiscal via RPC atómico. Fuente de
 * verdad del número fiscal; se llama al crear la venta / nota de crédito.
 * Intenta `siguiente_correlativo_cai_v2(tipo, punto)` (script officemart-004,
 * CAI por punto de facturación, devuelve también rango/fecha límite/imprenta)
 * y, si el RPC no existe y el punto es 0, cae al `siguiente_correlativo_cai`
 * clásico (script 061). Devuelve:
 *   - { data, error: null }  si emitió un folio.
 *   - { data: null, error }  si no hay config / rango agotado / RPC ausente.
 * En error, el llamador puede degradar (venta sin número fiscal).
 */
export async function emitirCorrelativoCai(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  tipoDocumento: string = '01',
  puntoId: number = 0
): Promise<{ data: CorrelativoCaiEmitido | null; error: string | null }> {
  try {
    const v2 = await supabase.rpc('siguiente_correlativo_cai_v2', {
      p_tipo_documento: tipoDocumento,
      p_punto_id: puntoId || 0,
    })
    if (!v2.error) {
      const fila = Array.isArray(v2.data) ? v2.data[0] : v2.data
      if (!fila || !fila.numero) return { data: null, error: 'Sin correlativo emitido' }
      return { data: mapCorrelativoFila(fila, tipoDocumento), error: null }
    }
    if (!isMissingFunction(v2.error)) return { data: null, error: v2.error.message }
    if ((puntoId || 0) !== 0) {
      console.warn('[emitirCorrelativoCai] RPC v2 ausente; corre scripts/officemart-004 para CAI por punto.')
      return { data: null, error: 'CAI por punto requiere el script officemart-004.' }
    }

    const { data, error } = await supabase.rpc('siguiente_correlativo_cai', {
      p_tipo_documento: tipoDocumento,
    })
    if (error) {
      // 42883 = función inexistente (script 061 sin correr). No es error "duro".
      if (isMissingFunction(error)) {
        console.warn('[emitirCorrelativoCai] RPC ausente; corre scripts/061.')
      }
      return { data: null, error: error.message }
    }
    const fila = Array.isArray(data) ? data[0] : data
    if (!fila || !fila.numero) return { data: null, error: 'Sin correlativo emitido' }
    return { data: mapCorrelativoFila(fila, tipoDocumento), error: null }
  } catch (e) {
    console.warn('[emitirCorrelativoCai] excepción:', e)
    return { data: null, error: 'Error de conexión' }
  }
}

/**
 * PEEK (solo lectura, NO consume): el número fiscal que se emitiría a
 * continuación para un punto, para mostrarlo en Nueva Venta. Devuelve null si
 * no hay config activa o el RPC no está disponible.
 */
export async function peekCorrelativoCai(tipoDocumento: string = '01', puntoId: number = 0): Promise<string | null> {
  const supabase = createClient()
  if (!supabase) return null
  try {
    const v2 = await supabase.rpc('peek_correlativo_cai_v2', {
      p_tipo_documento: tipoDocumento,
      p_punto_id: puntoId || 0,
    })
    if (!v2.error) return typeof v2.data === 'string' && v2.data ? v2.data : null
    if (!isMissingFunction(v2.error) || (puntoId || 0) !== 0) return null
    const { data, error } = await supabase.rpc('peek_correlativo_cai', {
      p_tipo_documento: tipoDocumento,
    })
    if (error) return null
    return typeof data === 'string' && data ? data : null
  } catch {
    return null
  }
}

/** Desglose fiscal del SAR (importes por régimen + ISV por tasa). */
export interface DesgloseFiscal {
  importeExento: number
  importeExonerado: number
  importeGravado15: number
  importeGravado18: number
  isv15: number
  isv18: number
}

/**
 * Calcula el desglose fiscal de una venta (Fase 2). Regla acordada: TODO gravado
 * 15% o TODO exento según el toggle de ISV de la venta; 18% y exonerado quedan
 * en cero (preparados para una fase futura por producto). Función pura.
 *
 * @param baseNeta  subtotal - descuento (base imponible / exenta, sin ISV)
 * @param isv       ISV total ya calculado en la venta
 * @param aplicaIsv toggle de la venta (mostrarIsv / aplica_impuesto)
 */
export function calcularDesgloseFiscal(
  baseNeta: number,
  isv: number,
  aplicaIsv: boolean
): DesgloseFiscal {
  const base = +(baseNeta || 0).toFixed(2)
  if (aplicaIsv) {
    return {
      importeExento: 0,
      importeExonerado: 0,
      importeGravado15: base,
      importeGravado18: 0,
      isv15: +(isv || 0).toFixed(2),
      isv18: 0,
    }
  }
  return {
    importeExento: base,
    importeExonerado: 0,
    importeGravado15: 0,
    importeGravado18: 0,
    isv15: 0,
    isv18: 0,
  }
}

/** Formatea una fecha YYYY-MM-DD a dd/mm/aaaa (o '' si null). */
export function fmtFechaCorta(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

/** Total en letras de un monto (re-export conveniente para los imprimibles). */
export function totalEnLetras(monto: number): string {
  return montoEnLetrasLempiras(monto)
}

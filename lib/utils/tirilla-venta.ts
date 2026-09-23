/**
 * Construye el HTML de una tirilla termica (80 mm) para una venta.
 *
 * Devuelve un documento HTML COMPLETO listo para `printTirilla` (incluye el
 * `<style id="page-style">` con el @page que el helper sobrescribe con el alto
 * exacto medido). No imprime ni toca el DOM: solo arma el string, asi es
 * facil de testear y reutilizar (Nueva Venta, Historial, reimpresion, etc.).
 */
import { formatCurrency, formatNumber } from "@/lib/utils/format"

export interface TirillaEmpresa {
  nombre: string
  rtn?: string | null
  direccion?: string | null
  telefono?: string | null
  /** URL absoluta de un logo a imprimir arriba de la tirilla (opcional). */
  logoUrl?: string | null
}

export interface TirillaLinea {
  nombre: string
  cantidad: number
  precioUnitario: number
  /** Codigo del producto; se imprime bajo el nombre si mostrarCodigoProducto. */
  codigo?: string | null
}

export interface TirillaPago {
  metodo: string
  monto: number
}

/**
 * Datos fiscales del SAR (Honduras) para el comprobante CAI. Cuando `cai` y
 * `numeroFiscal` vienen presentes, la tirilla se imprime como factura fiscal
 * (encabezado CAI + desglose gravado/exento + total en letras). Si faltan, la
 * tirilla sale como el recibo interno de siempre (retrocompatible).
 */
export interface TirillaFiscal {
  cai: string
  /** Correlativo fiscal completo 'ESTAB-PUNTO-TIPO-NNNNNNNN'. */
  numeroFiscal: string
  /** Rango autorizado, ya formateado (inicial y final). */
  rangoDesde?: string | null
  rangoHasta?: string | null
  /** Fecha límite de emisión, ya formateada (dd/mm/aaaa) o null. */
  fechaLimite?: string | null
  /** RTN del cliente (o null si Consumidor Final). */
  clienteRtn?: string | null
  /** true si es Consumidor Final (imprime la leyenda). */
  esConsumidorFinal?: boolean
  /** Desglose fiscal (Fase 2: todo gravado 15% o todo exento según el toggle). */
  importeExento: number
  importeExonerado: number
  importeGravado15: number
  importeGravado18: number
  isv15: number
  isv18: number
  /** Importe total en letras (p.ej. "MIL ... LEMPIRAS Y CERO CENTAVOS EXACTOS"). */
  totalEnLetras: string
  /** Datos de la imprenta, si la empresa emite por imprenta. */
  imprentaNombre?: string | null
  imprentaRtn?: string | null
  imprentaRegistro?: string | null
}

export interface TirillaVenta {
  empresa: TirillaEmpresa
  numeroFactura: string
  /** ISO string; se formatea a fecha+hora local es-HN. */
  fechaISO: string
  cliente: string
  /** Datos fiscales CAI (opcional). Si viene, la tirilla es comprobante SAR. */
  fiscal?: TirillaFiscal | null
  lineas: TirillaLinea[]
  subtotal: number
  descuentoPct: number
  descuentoMonto: number
  /** Si es false, no se imprime la fila de ISV (empresa sin ISV). */
  mostrarIsv: boolean
  isv: number
  total: number
  pagos: TirillaPago[]
  valorPagado: number
  saldo: number
  /** Efectivo con el que pagó el cliente (para mostrar el vuelto). Opcional. */
  efectivoRecibido?: number | null
  /** Vuelto/cambio a devolver (efectivoRecibido − efectivo aplicado). Opcional. */
  vuelto?: number | null
  /** Si es true, imprime el codigo de cada producto bajo su nombre. */
  mostrarCodigoProducto?: boolean
  /** Venta ANULADA (script officemart-003): se reimprime con la leyenda. */
  anulada?: boolean
  motivoAnulacion?: string | null
}

/** Escapa `< > &` para no romper el HTML con nombres/direcciones del usuario. */
const esc = (s: string | null | undefined): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

/** Etiqueta legible del metodo de pago (con la cuenta si aplica). */
export function metodoPagoLabel(metodo: string, cuentaNombre?: string | null): string {
  const base =
    metodo === "Efectivo"
      ? "Efectivo"
      : metodo === "Banco"
        ? "Banco"
        : metodo === "Link_Pago"
          ? "Link de Pago"
          : metodo === "Credito"
            ? "Credito"
            : "Otro"
  return cuentaNombre ? `${base} - ${cuentaNombre}` : base
}

function fmtFechaHora(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-HN", {
      // fecha_venta se guarda HN-as-UTC: leer en UTC para no restar 6h
      // (una venta de las 19:00 se imprimia 13:00 sin esto).
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export function buildTirillaVentaHtml(v: TirillaVenta): string {
  const e = v.empresa

  const subLines: string[] = []
  if (e.rtn) subLines.push(`RTN: ${esc(e.rtn)}`)
  if (e.direccion) subLines.push(esc(e.direccion))
  if (e.telefono) subLines.push(`Tel: ${esc(e.telefono)}`)
  const subHtml = subLines.map((l) => `<div class="sub">${l}</div>`).join("")

  const itemsHtml = v.lineas
    .map((l) => {
      const lineaTotal = l.cantidad * l.precioUnitario
      const codigoHtml =
        v.mostrarCodigoProducto && l.codigo
          ? `<div class="item-code">Cod: ${esc(l.codigo)}</div>`
          : ""
      return `<div class="item">
  <div class="item-name">${esc(l.nombre)}</div>
  ${codigoHtml}
  <div class="row">
    <span>${formatNumber(l.cantidad)} x ${formatCurrency(l.precioUnitario)}</span>
    <span>${formatCurrency(lineaTotal)}</span>
  </div>
</div>`
    })
    .join("")

  const descuentoHtml =
    v.descuentoMonto > 0
      ? `<div class="row"><span>Descuento (${formatNumber(v.descuentoPct)}%)</span><span>- ${formatCurrency(v.descuentoMonto)}</span></div>`
      : ""

  const isvHtml = v.mostrarIsv
    ? `<div class="row"><span>ISV (15%)</span><span>${formatCurrency(v.isv)}</span></div>`
    : ""

  const pagosHtml = v.pagos
    .map(
      (p) =>
        `<div class="row"><span>${esc(p.metodo)}</span><span>${formatCurrency(p.monto)}</span></div>`
    )
    .join("")

  const saldoHtml =
    v.saldo > 0
      ? `<div class="row bold"><span>SALDO PENDIENTE</span><span>${formatCurrency(v.saldo)}</span></div>`
      : ""

  const vueltoHtml =
    v.vuelto != null && v.vuelto > 0
      ? `<div class="row"><span>Efectivo recibido</span><span>${formatCurrency(v.efectivoRecibido ?? 0)}</span></div>` +
        `<div class="row bold"><span>Vuelto</span><span>${formatCurrency(v.vuelto)}</span></div>`
      : ""

  const f = v.fiscal || null

  // Encabezado fiscal (CAI): reemplaza la linea "Factura: <numero>" cuando la
  // venta es comprobante SAR. Muestra CAI, correlativo fiscal, rango, fecha
  // limite y destino de los ejemplares (Original: Cliente).
  const anuladaHtml = v.anulada
    ? `<div class="center bold" style="font-size:14px;border:2px solid #000;padding:3px;margin:4px 0;">*** ANULADA ***</div>` +
      (v.motivoAnulacion ? `<div class="center" style="font-size:10px;">${esc(v.motivoAnulacion)}</div>` : "")
    : ""

  const encabezadoHtml = anuladaHtml + (f
    ? `<div class="center bold" style="font-size:13px;">FACTURA</div>
  <div class="meta"><b>CAI:</b> <span class="mono">${esc(f.cai)}</span></div>
  <div class="meta"><b>No.:</b> <span class="mono">${esc(f.numeroFiscal)}</span></div>
  ${f.rangoDesde && f.rangoHasta ? `<div class="meta"><b>Rango:</b> <span class="mono">${esc(f.rangoDesde)}</span> a <span class="mono">${esc(f.rangoHasta)}</span></div>` : ""}
  ${f.fechaLimite ? `<div class="meta"><b>Fecha límite de emisión:</b> ${esc(f.fechaLimite)}</div>` : ""}
  <div class="meta"><b>Fecha:</b> ${esc(fmtFechaHora(v.fechaISO))}</div>
  <div class="meta">Original: Cliente</div>`
    : `<div class="meta"><b>Factura:</b> ${esc(v.numeroFactura)}</div>
  <div class="meta"><b>Fecha:</b> ${esc(fmtFechaHora(v.fechaISO))}</div>`)

  // Cliente + RTN (o "CONSUMIDOR FINAL") en modo fiscal.
  const clienteHtml = f
    ? `<div class="meta"><b>Cliente:</b> ${f.esConsumidorFinal ? "CONSUMIDOR FINAL" : esc(v.cliente)}</div>
  ${f.clienteRtn ? `<div class="meta"><b>RTN:</b> ${esc(f.clienteRtn)}</div>` : ""}`
    : `<div class="meta"><b>Cliente:</b> ${esc(v.cliente)}</div>`

  // Desglose fiscal (exento / exonerado / gravado 15% / 18% / ISV) o el simple.
  const totalesHtml = f
    ? `<div class="row"><span>Subtotal</span><span>${formatCurrency(v.subtotal)}</span></div>
  ${descuentoHtml}
  <div class="row"><span>Importe exento</span><span>${formatCurrency(f.importeExento)}</span></div>
  <div class="row"><span>Importe exonerado</span><span>${formatCurrency(f.importeExonerado)}</span></div>
  <div class="row"><span>Importe gravado 15%</span><span>${formatCurrency(f.importeGravado15)}</span></div>
  ${f.importeGravado18 > 0 ? `<div class="row"><span>Importe gravado 18%</span><span>${formatCurrency(f.importeGravado18)}</span></div>` : ""}
  <div class="row"><span>ISV 15%</span><span>${formatCurrency(f.isv15)}</span></div>
  ${f.isv18 > 0 ? `<div class="row"><span>ISV 18%</span><span>${formatCurrency(f.isv18)}</span></div>` : ""}
  <div class="row total"><span>TOTAL</span><span>${formatCurrency(v.total)}</span></div>
  <div class="meta" style="margin-top:3px;"><b>Son:</b> ${esc(f.totalEnLetras)}</div>`
    : `<div class="row"><span>Subtotal</span><span>${formatCurrency(v.subtotal)}</span></div>
  ${descuentoHtml}
  ${isvHtml}
  <div class="row total"><span>TOTAL</span><span>${formatCurrency(v.total)}</span></div>`

  // Pie fiscal: datos de imprenta o leyenda de autoimpresor.
  const pieFiscalHtml = f
    ? f.imprentaNombre || f.imprentaRtn || f.imprentaRegistro
      ? `<div class="line"></div><div class="foot" style="font-size:10px;">
    Imprenta: ${esc(f.imprentaNombre ?? "")}${f.imprentaRtn ? ` · RTN ${esc(f.imprentaRtn)}` : ""}${f.imprentaRegistro ? ` · Reg. ${esc(f.imprentaRegistro)}` : ""}
  </div>`
      : `<div class="line"></div><div class="foot" style="font-size:10px;">Documento emitido por autoimpresor autorizado por el SAR.</div>`
    : ""

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<style id="page-style">
  /* Se sobrescribe dinamicamente con el alto exacto medido. */
  @page { size: 80mm 500mm; margin: 0 !important; }
</style>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { margin: 0; padding: 0; }
  body {
    width: 80mm;
    margin: 0;
    padding: 1mm 3mm 3mm 3mm;
    /* Sans-serif y peso alto: en impresoras termicas el texto delgado sale
       tenue; con bold se lee nitido sin verse deforme. */
    font-family: Arial, Helvetica, 'Segoe UI', sans-serif;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.45;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .center { text-align: center; }
  .logo   { display: block; margin: 0 auto 4px; max-width: 55mm; max-height: 30mm; width: auto; height: auto; }
  .emp    { font-size: 17px; font-weight: 800; text-align: center; word-wrap: break-word; }
  .sub    { font-size: 11px; font-weight: 700; text-align: center; line-height: 1.35; word-wrap: break-word; }
  .meta   { font-size: 12px; margin: 1px 0; word-wrap: break-word; }
  .mono   { font-family: 'Courier New', monospace; font-weight: 700; }
  .line   { border-top: 1px solid #000; margin: 5px 0; }
  .item       { margin: 4px 0; }
  .item-name  { font-size: 12px; font-weight: 800; word-wrap: break-word; }
  .item-code  { font-size: 10px; font-weight: 700; word-wrap: break-word; }
  .row    { display: flex; justify-content: space-between; font-size: 12px; margin: 2px 0; gap: 8px; }
  .row span:last-child { white-space: nowrap; text-align: right; }
  .row.bold   { font-weight: 800; }
  .row.total  { font-size: 16px; font-weight: 800; margin: 4px 0; }
  .foot   { text-align: center; font-size: 12px; margin-top: 8px; }
</style></head>
<body>
  ${e.logoUrl ? `<img class="logo" src="${esc(e.logoUrl)}" alt="">` : ""}
  <div class="emp">${esc(e.nombre)}</div>
  ${subHtml}
  <div class="line"></div>
  ${encabezadoHtml}
  ${clienteHtml}
  <div class="line"></div>
  ${itemsHtml}
  <div class="line"></div>
  ${totalesHtml}
  <div class="line"></div>
  <div class="meta"><b>Forma de pago</b></div>
  ${pagosHtml}
  <div class="row"><span>Pagado</span><span>${formatCurrency(v.valorPagado)}</span></div>
  ${saldoHtml}
  ${vueltoHtml}
  ${pieFiscalHtml}
  <div class="line"></div>
  <div class="foot">Gracias por su compra</div>
</body></html>`
}

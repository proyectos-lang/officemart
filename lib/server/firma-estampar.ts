import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

/**
 * Estampado del PDF firmado (SOLO servidor): pie con folio + hash + URL de
 * verificación en cada página y una "hoja de firmas" al final con la imagen
 * de cada firma (si la hay), nombre, rol, fecha, IP y método.
 */

export interface FirmaEstampa {
  nombre: string
  rol: string
  metodo: string
  firmado_en: string
  ip?: string | null
  png?: Uint8Array | null
}

export interface OpcionesEstampa {
  folio: string
  hash: string
  titulo: string
  empresa: string
  verificarUrl: string
  firmas: FirmaEstampa[]
}

const GRIS = rgb(0.45, 0.42, 0.4)
const NEGRO = rgb(0.11, 0.09, 0.09)
const LINEA = rgb(0.85, 0.83, 0.82)

/** Sustituye caracteres fuera de WinAnsi (Helvetica estándar) para no romper el encode. */
export function textoSeguro(s: string): string {
  return (s || "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x00-\xFF]/g, "?")
}

function pie(page: PDFPage, font: PDFFont, opts: OpcionesEstampa) {
  const { width } = page.getSize()
  const texto = textoSeguro(`Folio ${opts.folio} · SHA-256 ${opts.hash.slice(0, 24)}… · Verificar: ${opts.verificarUrl}`).replace("…", "...")
  const size = 6.5
  const w = font.widthOfTextAtSize(texto, size)
  page.drawText(texto, { x: Math.max(12, (width - w) / 2), y: 10, size, font, color: GRIS })
}

function fechaLegible(iso: string): string {
  // Convención HN-as-UTC: los componentes UTC son la hora de Honduras.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} (hora de Honduras)`
}

export async function estamparPdf(original: Uint8Array, opts: OpcionesEstampa): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  for (const page of pdf.getPages()) pie(page, font, opts)

  // Hoja de firmas.
  const [ref] = pdf.getPages()
  const { width, height } = ref ? ref.getSize() : { width: 595.28, height: 841.89 }
  let page = pdf.addPage([width, height])
  const margen = 48
  let y = height - margen

  const linea = (texto: string, size = 9, f: PDFFont = font, color = NEGRO) => {
    page.drawText(textoSeguro(texto), { x: margen, y, size, font: f, color })
    y -= size + 5
  }

  linea("HOJA DE FIRMAS ELECTRONICAS", 14, bold)
  y -= 4
  linea(opts.empresa, 10, bold)
  linea(`Documento: ${opts.titulo}`, 9)
  linea(`Folio: ${opts.folio}`, 9)
  linea(`SHA-256 del original: ${opts.hash}`, 7.5, font, GRIS)
  linea(`Verificacion: ${opts.verificarUrl}`, 7.5, font, GRIS)
  y -= 6
  page.drawLine({ start: { x: margen, y }, end: { x: width - margen, y }, thickness: 0.5, color: LINEA })
  y -= 18

  for (const f of opts.firmas) {
    const altoBloque = 96
    if (y - altoBloque < margen + 30) {
      pie(page, font, opts)
      page = pdf.addPage([width, height])
      y = height - margen
    }
    let imgAlto = 0
    if (f.png && f.png.length > 0) {
      try {
        const img = await pdf.embedPng(f.png)
        const maxW = 180
        const maxH = 60
        const esc = Math.min(maxW / img.width, maxH / img.height, 1)
        const w = img.width * esc
        const h = img.height * esc
        page.drawImage(img, { x: margen, y: y - h, width: w, height: h })
        imgAlto = h
      } catch {
        imgAlto = 0
      }
    }
    const xTexto = imgAlto > 0 ? margen + 196 : margen
    const yInicio = y
    const escribir = (t: string, size = 9, ff: PDFFont = font, color = NEGRO) => {
      page.drawText(textoSeguro(t), { x: xTexto, y, size, font: ff, color })
      y -= size + 4
    }
    escribir(f.nombre, 10, bold)
    escribir(`${f.rol === "interno" ? "Firmante interno" : "Firmante externo"} · ${f.metodo === "canvas" ? "firma manuscrita en pantalla" : "aceptacion con un clic"}`, 8, font, GRIS)
    escribir(`Firmado: ${fechaLegible(f.firmado_en)}`, 8)
    if (f.ip) escribir(`IP: ${f.ip}`, 8, font, GRIS)
    y = Math.min(y, yInicio - imgAlto) - 10
    page.drawLine({ start: { x: margen, y }, end: { x: width - margen, y }, thickness: 0.5, color: LINEA })
    y -= 16
  }

  y -= 4
  const legal = "Firma electronica simple conforme al Decreto 149-2013 (Ley sobre Firmas Electronicas, Honduras). La integridad del documento se comprueba con el hash SHA-256 y el folio en la URL de verificacion."
  page.drawText(textoSeguro(legal), { x: margen, y, size: 7, font, color: GRIS, maxWidth: width - margen * 2, lineHeight: 9 })
  pie(page, font, opts)

  return pdf.save()
}

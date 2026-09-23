import { describe, it, expect } from "vitest"
import {
  generarToken, generarFolio, sha256Hex, rutaDocumento, urlFirma, urlVerificacion,
  resumenFirmas, estaVencido, estadoVisible, validarFirmantes, fechaMasDiasISO,
} from "@/lib/services/firma-digital"
import { textoSeguro, estamparPdf } from "@/lib/server/firma-estampar"
import { plantillaSolicitudFirma } from "@/lib/server/correo"
import { PDFDocument } from "pdf-lib"

describe("tokens, folios y hashes", () => {
  it("token de 64 hex y distinto cada vez", () => {
    const a = generarToken()
    const b = generarToken()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
    expect(generarToken(8)).toHaveLength(16)
  })
  it("folio legible con empresa, fecha y sufijo", () => {
    expect(generarFolio(3, "2026-09-23T10:00:00.000Z", "abc123")).toBe("FD-3-20260923-ABC123")
    expect(generarFolio(3, "2026-09-23")).toMatch(/^FD-3-20260923-[A-Z2-9]{6}$/)
  })
  it("sha256 conocido", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })
  it("rutas y urls", () => {
    expect(rutaDocumento(3, "FD-3-20260923-ABC123", "original.pdf")).toBe("officemart/firmas/3/FD-3-20260923-ABC123-original.pdf")
    expect(urlFirma("https://app.com/", "tok")).toBe("https://app.com/firmar/tok")
    expect(urlVerificacion("https://app.com", "F1")).toBe("https://app.com/verificar/F1")
  })
})

describe("estados y validaciones", () => {
  it("resumenFirmas", () => {
    expect(resumenFirmas([{ firmado_en: "x" }, { firmado_en: null }])).toEqual({ total: 2, firmadas: 1, pendientes: 1, completo: false })
    expect(resumenFirmas([{ firmado_en: "x" }]).completo).toBe(true)
    expect(resumenFirmas([]).completo).toBe(false)
  })
  it("vencimiento solo aplica a pendientes", () => {
    const ahora = "2026-09-23T12:00:00.000Z"
    expect(estaVencido({ estado: "Pendiente", vence_en: "2026-09-22T00:00:00.000Z" }, ahora)).toBe(true)
    expect(estaVencido({ estado: "Firmado", vence_en: "2026-09-22T00:00:00.000Z" }, ahora)).toBe(false)
    expect(estaVencido({ estado: "Pendiente", vence_en: null }, ahora)).toBe(false)
    expect(estadoVisible({ estado: "Pendiente", vence_en: "2026-09-22T00:00:00.000Z" }, ahora)).toBe("Vencido")
    expect(estadoVisible({ estado: "Pendiente", vence_en: "2026-09-30T00:00:00.000Z" }, ahora)).toBe("Pendiente")
  })
  it("validarFirmantes", () => {
    expect(validarFirmantes([])).toMatch(/al menos un firmante/)
    expect(validarFirmantes([{ nombre: " " }])).toMatch(/al menos un firmante/)
    expect(validarFirmantes([{ nombre: "Ana", correo: "mal" }])).toMatch(/Correo inválido/)
    expect(validarFirmantes([{ nombre: "Ana", correo: "ana@x.com" }, { nombre: "Luis" }])).toBeNull()
  })
  it("fechaMasDiasISO", () => {
    expect(fechaMasDiasISO("2026-12-30T10:00:00.000Z", 5)).toBe("2027-01-04T10:00:00.000Z")
  })
})

describe("estampado", () => {
  it("textoSeguro reemplaza caracteres fuera de WinAnsi", () => {
    expect(textoSeguro("Cotización — “ok” ✓")).toBe('Cotización - "ok" ?')
  })
  it("agrega hoja de firmas y pie en cada página", async () => {
    const src = await PDFDocument.create()
    src.addPage([595, 842])
    src.addPage([595, 842])
    const bytes = await src.save()
    const out = await estamparPdf(bytes, {
      folio: "FD-1-20260923-ABC123",
      hash: "a".repeat(64),
      titulo: "Cotización COT-0001",
      empresa: "Office Mart",
      verificarUrl: "https://app.com/verificar/FD-1-20260923-ABC123",
      firmas: [
        { nombre: "Ana Pérez", rol: "externo", metodo: "clic", firmado_en: "2026-09-23T14:30:00.000Z", ip: "1.2.3.4", png: null },
        { nombre: "Luis", rol: "interno", metodo: "canvas", firmado_en: "2026-09-23T15:00:00.000Z", png: new Uint8Array([1, 2, 3]) }, // png inválido → se ignora
      ],
    })
    const res = await PDFDocument.load(out)
    expect(res.getPageCount()).toBe(3)
  })
  it("plantilla de correo escapa HTML y lleva el link", () => {
    const p = plantillaSolicitudFirma({ empresa: "Office <Mart>", firmante: "Ana", titulo: "Cotización", url: "https://app.com/firmar/t", venceEn: "30/09/2026" })
    expect(p.subject).toContain("Office <Mart>")
    expect(p.html).toContain("Office &lt;Mart&gt;")
    expect(p.html).toContain("https://app.com/firmar/t")
    expect(p.text).toContain("vence el 30/09/2026")
  })
})

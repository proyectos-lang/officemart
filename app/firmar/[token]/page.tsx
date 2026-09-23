"use client"

import { use, useEffect, useState } from "react"
import { FileSignature, CheckCircle2, AlertTriangle, Loader2, ExternalLink, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { CanvasFirma } from "@/components/firma/canvas-firma"
import { formatHondurasDate, formatHondurasDateTime } from "@/lib/utils/honduras-time"

interface DatosFirma {
  documento: { folio: string; titulo: string; entidad: string; estado: string; vence_en: string | null; mensaje: string | null; hash_sha256: string; firmado_at: string | null }
  empresa: { nombre: string; logo_url: string | null }
  firmante: { id: number; nombre: string; rol: string; ya_firmado: boolean; firmado_en: string | null; metodo: string | null }
  otros: { nombre: string; rol: string; firmado: boolean }[]
  pdf_url: string | null
  verificar_url: string
}

export default function FirmarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [datos, setDatos] = useState<DatosFirma | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [nombre, setNombre] = useState("")
  const [metodo, setMetodo] = useState<"canvas" | "clic">("canvas")
  const [png, setPng] = useState<string | null>(null)
  const [acepta, setAcepta] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ folio: string; completo: boolean; verificar_url: string; advertencia: string | null } | null>(null)

  useEffect(() => {
    let activo = true
    fetch(`/api/firma/${token}`)
      .then(async (r) => {
        const json = await r.json()
        if (!activo) return
        if (!r.ok) {
          setError(json.error || "No se pudo abrir el documento")
        } else {
          setDatos(json as DatosFirma)
          setNombre((json as DatosFirma).firmante.nombre)
        }
        setCargando(false)
      })
      .catch(() => {
        if (!activo) return
        setError("Error de conexión")
        setCargando(false)
      })
    return () => {
      activo = false
    }
  }, [token])

  async function firmar() {
    if (!datos) return
    setEnviando(true)
    setError(null)
    try {
      const r = await fetch(`/api/firma/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, metodo, firma_png: metodo === "canvas" ? png : undefined, acepta }),
      })
      const json = await r.json()
      if (!r.ok) {
        setError(json.error || "No se pudo registrar la firma")
      } else {
        setResultado({ folio: json.folio, completo: !!json.completo, verificar_url: json.verificar_url, advertencia: json.advertencia ?? null })
      }
    } catch {
      setError("Error de conexión")
    } finally {
      setEnviando(false)
    }
  }

  const puedeFirmar = !!nombre.trim() && acepta && (metodo === "clic" || !!png)

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="rounded-lg bg-stone-800 p-2 text-white"><FileSignature className="h-5 w-5" /></div>
          <div>
            <p className="font-semibold text-stone-800 leading-tight">{datos?.empresa.nombre || "Firma electrónica"}</p>
            <p className="text-xs text-muted-foreground">Documento para firma electrónica</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {cargando && <div className="flex items-center gap-2 py-16 justify-center text-sm text-muted-foreground"><Spinner /> Abriendo documento…</div>}

        {!cargando && error && !datos && (
          <Card className="border-red-200"><CardContent className="p-6 text-center space-y-2">
            <AlertTriangle className="h-8 w-8 text-red-600 mx-auto" />
            <p className="font-medium">{error}</p>
            <p className="text-sm text-muted-foreground">Si crees que es un error, contacta a quien te envió el documento.</p>
          </CardContent></Card>
        )}

        {datos && resultado && (
          <Card className="border-emerald-200"><CardContent className="p-6 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
            <p className="text-lg font-semibold">¡Firma registrada!</p>
            <p className="text-sm text-muted-foreground">Folio <span className="font-mono">{resultado.folio}</span>. {resultado.completo ? "Todos los firmantes han firmado; el PDF final ya está disponible para el emisor." : "Faltan otras firmas; el emisor recibirá el PDF final cuando todos firmen."}</p>
            {resultado.advertencia && <p className="text-xs text-amber-700">{resultado.advertencia}</p>}
            <Button variant="outline" asChild className="gap-1"><a href={resultado.verificar_url} target="_blank" rel="noreferrer"><ShieldCheck className="h-4 w-4" /> Ver verificación pública</a></Button>
          </CardContent></Card>
        )}

        {datos && !resultado && (
          <>
            <Card><CardContent className="p-4 md:p-6 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h1 className="text-xl font-semibold text-stone-800">{datos.documento.titulo}</h1>
                  <p className="text-xs text-muted-foreground font-mono">Folio {datos.documento.folio}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {datos.documento.vence_en && <p>Vence: {formatHondurasDate(datos.documento.vence_en)}</p>}
                  <p>Firmante: <strong>{datos.firmante.nombre}</strong></p>
                </div>
              </div>
              {datos.documento.mensaje && <p className="text-sm rounded-md bg-stone-50 border p-3 whitespace-pre-wrap">{datos.documento.mensaje}</p>}
              {datos.pdf_url ? (
                <div className="space-y-2">
                  <div className="rounded-lg border overflow-hidden bg-stone-200">
                    <iframe src={datos.pdf_url} title="Documento" className="w-full h-[60vh] bg-white" />
                  </div>
                  <Button variant="outline" size="sm" asChild className="gap-1"><a href={datos.pdf_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Abrir el PDF en otra pestaña</a></Button>
                </div>
              ) : (
                <p className="text-sm text-amber-700">No se pudo cargar la vista previa del PDF.</p>
              )}
              {datos.otros.length > 0 && (
                <div className="text-xs text-muted-foreground flex flex-wrap gap-2 items-center">Otros firmantes: {datos.otros.map((o, i) => <Badge key={i} variant={o.firmado ? "default" : "outline"}>{o.nombre}{o.firmado ? " ✓" : ""}</Badge>)}</div>
              )}
            </CardContent></Card>

            {datos.firmante.ya_firmado ? (
              <Card className="border-emerald-200"><CardContent className="p-4 text-sm flex items-center gap-2 text-emerald-800"><CheckCircle2 className="h-5 w-5" /> Ya firmaste este documento el {formatHondurasDateTime(datos.firmante.firmado_en)}. <a className="underline ml-auto" href={datos.verificar_url} target="_blank" rel="noreferrer">Verificación</a></CardContent></Card>
            ) : datos.documento.estado !== "Pendiente" ? (
              <Card><CardContent className="p-4 text-sm text-muted-foreground">Este documento ya no admite firmas (estado: {datos.documento.estado}).</CardContent></Card>
            ) : (
              <Card><CardContent className="p-4 md:p-6 space-y-4">
                <h2 className="font-semibold text-stone-800">Firmar</h2>
                <div className="space-y-1">
                  <Label>Tu nombre completo</Label>
                  <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </div>
                <div className="flex gap-2 text-sm">
                  <button type="button" className={`px-3 py-1.5 rounded-md border ${metodo === "canvas" ? "bg-stone-800 text-white border-stone-800" : "bg-white"}`} onClick={() => setMetodo("canvas")}>Firma manuscrita</button>
                  <button type="button" className={`px-3 py-1.5 rounded-md border ${metodo === "clic" ? "bg-stone-800 text-white border-stone-800" : "bg-white"}`} onClick={() => setMetodo("clic")}>Aceptar con un clic</button>
                </div>
                {metodo === "canvas" && <CanvasFirma onChange={setPng} />}
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={acepta} onCheckedChange={(v) => setAcepta(v === true)} className="mt-0.5" />
                  <span>Declaro que he revisado el documento y acepto firmarlo electrónicamente. Se registrará mi nombre, fecha y hora, dirección IP y navegador como evidencia (firma electrónica simple, Decreto 149-2013, Honduras).</span>
                </label>
                {error && <p className="text-sm text-red-700 flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> {error}</p>}
                <Button onClick={firmar} disabled={!puedeFirmar || enviando} className="w-full sm:w-auto gap-1">{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />} Firmar documento</Button>
              </CardContent></Card>
            )}
          </>
        )}
        <p className="text-center text-xs text-stone-400 pt-4">Generado por EasyCount · verificación en {datos?.verificar_url ? <a className="underline" href={datos.verificar_url}>{datos.verificar_url.replace(/^https?:\/\//, "")}</a> : "/verificar/<folio>"}</p>
      </main>
    </div>
  )
}

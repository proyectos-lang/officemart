"use client"

import { use, useEffect, useState } from "react"
import { ShieldCheck, ShieldX, AlertTriangle, Upload, CheckCircle2, XCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { formatHondurasDateTime } from "@/lib/utils/honduras-time"
import { sha256Hex } from "@/lib/services/firma-digital"

interface Verificacion {
  folio: string
  titulo: string
  entidad: string
  estado: string
  empresa: string
  created_at: string
  firmado_at: string | null
  anulado_at: string | null
  hash_sha256: string
  hash_firmado_sha256: string | null
  firmas: { nombre: string; rol: string; metodo: string | null; firmado_en: string | null }[]
}

export default function VerificarPage({ params }: { params: Promise<{ folio: string }> }) {
  const { folio } = use(params)
  const [datos, setDatos] = useState<Verificacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [comprobacion, setComprobacion] = useState<{ hash: string; coincide: "original" | "firmado" | null } | null>(null)

  useEffect(() => {
    let activo = true
    fetch(`/api/verificar/${folio}`)
      .then(async (r) => {
        const json = await r.json()
        if (!activo) return
        if (!r.ok) setError(json.error || "No se pudo verificar")
        else setDatos(json as Verificacion)
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
  }, [folio])

  async function comprobarArchivo(file: File | null) {
    if (!file || !datos) return
    const hash = await sha256Hex(await file.arrayBuffer())
    setComprobacion({ hash, coincide: hash === datos.hash_sha256 ? "original" : hash === datos.hash_firmado_sha256 ? "firmado" : null })
  }

  const ok = datos?.estado === "Firmado"

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="bg-white border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="rounded-lg bg-stone-800 p-2 text-white"><ShieldCheck className="h-5 w-5" /></div>
          <div>
            <p className="font-semibold text-stone-800 leading-tight">Verificación de documento firmado</p>
            <p className="text-xs text-muted-foreground font-mono">{folio}</p>
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {cargando && <div className="flex items-center gap-2 py-16 justify-center text-sm text-muted-foreground"><Spinner /> Consultando…</div>}
        {!cargando && error && (
          <Card className="border-red-200"><CardContent className="p-6 text-center space-y-2"><ShieldX className="h-8 w-8 text-red-600 mx-auto" /><p className="font-medium">{error}</p></CardContent></Card>
        )}
        {datos && (
          <>
            <Card className={ok ? "border-emerald-300" : datos.estado === "Anulado" ? "border-red-300" : "border-amber-300"}>
              <CardContent className="p-5 space-y-2">
                <div className="flex items-center gap-2">
                  {ok ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : datos.estado === "Anulado" ? <XCircle className="h-6 w-6 text-red-600" /> : <AlertTriangle className="h-6 w-6 text-amber-600" />}
                  <p className="text-lg font-semibold">{ok ? "Documento firmado por todos los firmantes" : datos.estado === "Anulado" ? "Documento anulado por el emisor" : `Documento ${datos.estado.toLowerCase()} (firma incompleta)`}</p>
                </div>
                <p className="text-sm"><strong>{datos.titulo}</strong> · emitido por {datos.empresa}</p>
                <p className="text-xs text-muted-foreground">Creado {formatHondurasDateTime(datos.created_at)}{datos.firmado_at ? ` · firmado ${formatHondurasDateTime(datos.firmado_at)}` : ""}{datos.anulado_at ? ` · anulado ${formatHondurasDateTime(datos.anulado_at)}` : ""}</p>
              </CardContent>
            </Card>
            <Card><CardContent className="p-5 space-y-2">
              <p className="font-medium text-sm">Firmantes</p>
              {datos.firmas.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                  <span>{f.nombre} <Badge variant="outline" className="ml-1 text-[10px]">{f.rol}</Badge></span>
                  <span className="text-xs text-muted-foreground">{f.firmado_en ? `Firmó ${formatHondurasDateTime(f.firmado_en)} (${f.metodo === "canvas" ? "manuscrita" : "clic"})` : "Pendiente"}</span>
                </div>
              ))}
            </CardContent></Card>
            <Card><CardContent className="p-5 space-y-3">
              <p className="font-medium text-sm">Integridad (SHA-256)</p>
              <p className="text-xs"><span className="text-muted-foreground">Original:</span> <span className="font-mono break-all">{datos.hash_sha256}</span></p>
              {datos.hash_firmado_sha256 && <p className="text-xs"><span className="text-muted-foreground">PDF firmado:</span> <span className="font-mono break-all">{datos.hash_firmado_sha256}</span></p>}
              <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border border-dashed p-3 hover:bg-stone-50">
                <Upload className="h-4 w-4" /> Sube el PDF que tienes para comprobar que no fue alterado
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => comprobarArchivo(e.target.files?.[0] ?? null)} />
              </label>
              {comprobacion && (
                <p className={`text-sm flex items-center gap-1 ${comprobacion.coincide ? "text-emerald-700" : "text-red-700"}`}>
                  {comprobacion.coincide ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {comprobacion.coincide === "original" ? "Coincide con el documento original." : comprobacion.coincide === "firmado" ? "Coincide con el PDF firmado." : "NO coincide con ningún archivo registrado: el PDF fue modificado o no es este documento."}
                </p>
              )}
            </CardContent></Card>
            <p className="text-center text-xs text-stone-400">Firma electrónica simple (Decreto 149-2013, Honduras). Generado por EasyCount.</p>
          </>
        )}
      </main>
    </div>
  )
}

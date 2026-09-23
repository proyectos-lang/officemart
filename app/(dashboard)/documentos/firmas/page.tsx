"use client"

import * as React from "react"
import { FileSignature, Download, Copy, Check, Mail, ExternalLink, XCircle, AlertTriangle, Loader2, Search, ShieldCheck, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TablePaginator } from "@/components/ui/table-paginator"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatHondurasDate, formatHondurasDateTime, getHondurasNowISO } from "@/lib/utils/honduras-time"
import {
  getDocumentosFirmados, anularDocumentoFirma, urlDescargaDocumento, enviarCorreoFirma,
  urlFirma, urlVerificacion, resumenFirmas, estadoVisible, ETIQUETA_ENTIDAD,
  type DocumentoFirmado, type EstadoDocumento,
} from "@/lib/services/firma-digital"

type FiltroEstado = EstadoDocumento | "Todos"

export default function FirmasPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState<string | null>(null)
  const [docs, setDocs] = React.useState<DocumentoFirmado[]>([])
  const [estado, setEstado] = React.useState<FiltroEstado>("Todos")
  const [busqueda, setBusqueda] = React.useState("")
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)
  const [detalle, setDetalle] = React.useState<DocumentoFirmado | null>(null)
  const [anular, setAnular] = React.useState<{ doc: DocumentoFirmado | null; motivo: string; saving: boolean }>({ doc: null, motivo: "", saving: false })
  const [descargando, setDescargando] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState<Record<number, boolean>>({})
  const [copiado, setCopiado] = React.useState<number | null>(null)
  const ahora = getHondurasNowISO()
  const origin = typeof window !== "undefined" ? window.location.origin : ""

  const cargar = React.useCallback(async () => {
    const res = await getDocumentosFirmados()
    if (res.pendiente) setPendiente(res.error)
    else if (res.error) toast({ title: "No se pudieron cargar los documentos", description: res.error, variant: "destructive" })
    setDocs(res.data)
    setLoading(false)
  }, [toast])

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    getDocumentosFirmados().then((res) => {
      if (!activo) return
      if (res.pendiente) setPendiente(res.error)
      else if (res.error) toast({ title: "No se pudieron cargar los documentos", description: res.error, variant: "destructive" })
      setDocs(res.data)
      setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId, toast])

  const visibles = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return docs.filter((d) => (estado === "Todos" || estadoVisible(d, ahora) === estado) && (!q || [d.folio, d.titulo, ...d.firmas.map((f) => f.nombre)].some((s) => (s || "").toLowerCase().includes(q))))
  }, [docs, estado, busqueda, ahora])

  async function descargar(path: string | null, clave: string) {
    if (!path) return
    setDescargando(clave)
    const { url, error } = await urlDescargaDocumento(path)
    setDescargando(null)
    if (!url) return toast({ title: "No se pudo descargar", description: error ?? "", variant: "destructive" })
    window.open(url, "_blank", "noopener")
  }

  async function enviar(firmaId: number) {
    setEnviando((p) => ({ ...p, [firmaId]: true }))
    const r = await enviarCorreoFirma(firmaId)
    setEnviando((p) => ({ ...p, [firmaId]: false }))
    toast({ title: r.enviado ? "Correo enviado" : "No se envió", description: r.enviado ? undefined : r.motivo ?? "", variant: r.enviado ? undefined : "destructive" })
    if (r.enviado) cargar()
  }

  async function copiar(id: number, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(id)
      setTimeout(() => setCopiado(null), 1500)
    } catch {
      toast({ title: "Copia el enlace manualmente", description: url })
    }
  }

  async function confirmarAnular() {
    if (!anular.doc) return
    setAnular((p) => ({ ...p, saving: true }))
    const res = await anularDocumentoFirma(anular.doc.id, anular.motivo)
    setAnular((p) => ({ ...p, saving: false }))
    if (!res.success) return toast({ title: "No se pudo anular", description: res.error ?? "", variant: "destructive" })
    toast({ title: "Solicitud anulada" })
    setAnular({ doc: null, motivo: "", saving: false })
    setDetalle(null)
    cargar()
  }

  const badgeEstado = (d: DocumentoFirmado) => {
    const e = estadoVisible(d, ahora)
    if (e === "Firmado") return <Badge className="bg-emerald-600">Firmado</Badge>
    if (e === "Anulado") return <Badge variant="destructive">Anulado</Badge>
    if (e === "Vencido") return <Badge variant="outline" className="text-amber-700 border-amber-300">Vencido</Badge>
    return <Badge variant="secondary">Pendiente</Badge>
  }

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><FileSignature className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Firma digital</h1>
            <p className="text-sm text-muted-foreground">Documentos enviados a firma electrónica: estado, enlaces, PDF firmado y verificación por folio.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8 w-[200px]" placeholder="Folio, título, firmante…" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPageIndex(0) }} />
          </div>
          <Select value={estado} onValueChange={(v) => { setEstado(v as FiltroEstado); setPageIndex(0) }}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Todos">Todos</SelectItem>
              <SelectItem value="Pendiente">Pendientes</SelectItem>
              <SelectItem value="Firmado">Firmados</SelectItem>
              <SelectItem value="Vencido">Vencidos</SelectItem>
              <SelectItem value="Anulado">Anulados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {pendiente && <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {pendiente}</CardContent></Card>}

      <Card className="border-stone-200 bg-stone-50"><CardContent className="p-3 text-xs text-muted-foreground">
        Las solicitudes se crean desde el documento (Cotizaciones → menú → Enviar a firma; Estado de cuenta → Enviar a firma). El firmante abre un enlace único, revisa el PDF y firma en pantalla; al firmar todos, se genera el PDF con la hoja de firmas y el folio. Firma electrónica simple (Decreto 149-2013), no certificada.
      </CardContent></Card>

      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow className="bg-stone-50">
              <TableHead>Folio</TableHead><TableHead>Documento</TableHead><TableHead>Firmantes</TableHead><TableHead>Estado</TableHead><TableHead>Vence</TableHead><TableHead>Creado</TableHead><TableHead className="w-40"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map((d) => {
              const r = resumenFirmas(d.firmas)
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.folio}</TableCell>
                  <TableCell><p className="font-medium text-sm">{d.titulo}</p><p className="text-xs text-muted-foreground">{ETIQUETA_ENTIDAD[d.entidad] || d.entidad}</p></TableCell>
                  <TableCell><span className="text-sm">{r.firmadas}/{r.total}</span><p className="text-xs text-muted-foreground truncate max-w-[220px]">{d.firmas.map((f) => f.nombre).join(", ")}</p></TableCell>
                  <TableCell>{badgeEstado(d)}</TableCell>
                  <TableCell className="text-xs">{d.vence_en ? formatHondurasDate(d.vence_en) : "—"}</TableCell>
                  <TableCell className="text-xs">{formatHondurasDate(d.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Detalle" onClick={() => setDetalle(d)}><Eye className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title={d.pdf_firmado_path ? "Descargar PDF firmado" : "Descargar PDF original"} onClick={() => descargar(d.pdf_firmado_path || d.pdf_original_path, `d${d.id}`)} disabled={descargando === `d${d.id}`}>
                        {descargando === `d${d.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Verificación pública" asChild><a href={urlVerificacion(origin, d.folio)} target="_blank" rel="noreferrer"><ShieldCheck className="h-4 w-4" /></a></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {visibles.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Sin documentos.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <TablePaginator pageIndex={pageIndex} pageSize={pageSize} totalItems={visibles.length} onPageIndexChange={setPageIndex} onPageSizeChange={(s) => { setPageSize(s); setPageIndex(0) }} />

      <Dialog open={detalle != null} onOpenChange={(o) => { if (!o) setDetalle(null) }}>
        <DialogContent className="sm:max-w-2xl">
          {detalle && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">{detalle.titulo} {badgeEstado(detalle)}</DialogTitle>
                <DialogDescription className="font-mono text-xs">{detalle.folio} · SHA-256 {detalle.hash_sha256.slice(0, 16)}…</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {detalle.firmas.map((f) => {
                  const url = urlFirma(origin, f.token)
                  const abierto = estadoVisible(detalle, ahora) === "Pendiente"
                  return (
                    <div key={f.id} className="rounded-md border p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{f.nombre} <Badge variant="outline" className="ml-1 text-[10px]">{f.rol}</Badge> {f.firmado_en ? <Badge className="ml-1 bg-emerald-600 text-[10px]">Firmó {formatHondurasDateTime(f.firmado_en)}</Badge> : <Badge variant="secondary" className="ml-1 text-[10px]">Pendiente</Badge>}</p>
                          <p className="text-xs text-muted-foreground">{f.correo || "sin correo"}{f.enviado_at ? ` · correo enviado ${formatHondurasDateTime(f.enviado_at)}` : ""}{f.visto_at ? ` · visto ${formatHondurasDateTime(f.visto_at)}` : ""}</p>
                          {f.firmado_en && <p className="text-xs text-muted-foreground">Método: {f.metodo === "canvas" ? "firma en pantalla" : "clic"}{f.ip ? ` · IP ${f.ip}` : ""}{f.nombre_firmante && f.nombre_firmante !== f.nombre ? ` · firmó como "${f.nombre_firmante}"` : ""}</p>}
                        </div>
                        {abierto && !f.firmado_en && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => copiar(f.id, url)}>{copiado === f.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Link</Button>
                            {f.correo && <Button size="sm" variant="outline" className="gap-1" onClick={() => enviar(f.id)} disabled={enviando[f.id]}>{enviando[f.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Correo</Button>}
                            {f.rol === "interno" && <Button size="sm" asChild className="gap-1"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Firmar</a></Button>}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {detalle.mensaje && <p className="text-xs text-muted-foreground">Mensaje: {detalle.mensaje}</p>}
                {detalle.motivo_anulacion && <p className="text-xs text-red-700">Anulado: {detalle.motivo_anulacion}</p>}
              </div>
              <DialogFooter className="flex-wrap gap-2">
                <Button variant="outline" className="gap-1" onClick={() => descargar(detalle.pdf_original_path, "orig")} disabled={descargando === "orig"}><Download className="h-4 w-4" /> Original</Button>
                {detalle.pdf_firmado_path && <Button variant="outline" className="gap-1" onClick={() => descargar(detalle.pdf_firmado_path, "firm")} disabled={descargando === "firm"}><Download className="h-4 w-4" /> Firmado</Button>}
                {estadoVisible(detalle, ahora) !== "Firmado" && estadoVisible(detalle, ahora) !== "Anulado" && (
                  <Button variant="destructive" className="gap-1" onClick={() => setAnular({ doc: detalle, motivo: "", saving: false })}><XCircle className="h-4 w-4" /> Anular</Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={anular.doc != null} onOpenChange={(o) => { if (!o) setAnular({ doc: null, motivo: "", saving: false }) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Anular solicitud</DialogTitle><DialogDescription>Los enlaces dejarán de funcionar. {anular.doc?.folio}</DialogDescription></DialogHeader>
          <div className="space-y-1"><Label>Motivo</Label><Input value={anular.motivo} onChange={(e) => setAnular((p) => ({ ...p, motivo: e.target.value }))} autoFocus /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnular({ doc: null, motivo: "", saving: false })}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarAnular} disabled={anular.saving || !anular.motivo.trim()}>{anular.saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Anular</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

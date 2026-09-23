"use client"

import * as React from "react"
import Link from "next/link"
import { Plus, Trash2, Loader2, Copy, Check, Mail, ExternalLink, FileSignature } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  solicitarFirma, enviarCorreoFirma, urlFirma, urlVerificacion,
  type DocumentoFirmado, type EntidadFirma, type FirmanteInput, type RolFirmante,
} from "@/lib/services/firma-digital"

export interface EnviarFirmaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entidad: EntidadFirma
  entidadId?: number | null
  titulo: string
  /** Genera el PDF a firmar (jsPDF → blob). Se llama al confirmar. */
  generarPdf: () => Promise<Blob>
  firmantesSugeridos?: FirmanteInput[]
  onCreado?: (doc: DocumentoFirmado) => void
}

type FilaFirmante = FirmanteInput & { _key: number }

let seq = 0
const nuevaFila = (f?: FirmanteInput): FilaFirmante => ({ _key: ++seq, nombre: f?.nombre ?? "", correo: f?.correo ?? "", rol: f?.rol ?? "externo" })

/** Diálogo reutilizable: firmantes → genera PDF → crea la solicitud → muestra links y envía correos. */
export function EnviarFirmaDialog(props: EnviarFirmaDialogProps) {
  const { open, onOpenChange, titulo } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSignature className="h-5 w-5" /> Enviar a firma</DialogTitle>
          <DialogDescription className="truncate">{titulo}</DialogDescription>
        </DialogHeader>
        {open && <Contenido key={titulo} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function Contenido({ onOpenChange, entidad, entidadId, titulo, generarPdf, firmantesSugeridos, onCreado }: EnviarFirmaDialogProps) {
  const { toast } = useToast()
  const [firmantes, setFirmantes] = React.useState<FilaFirmante[]>(() => (firmantesSugeridos && firmantesSugeridos.length > 0 ? firmantesSugeridos.map(nuevaFila) : [nuevaFila()]))
  const [venceDias, setVenceDias] = React.useState("15")
  const [mensaje, setMensaje] = React.useState("")
  const [paso, setPaso] = React.useState<"form" | "creando" | "listo">("form")
  const [doc, setDoc] = React.useState<DocumentoFirmado | null>(null)
  const [enviando, setEnviando] = React.useState<Record<number, boolean>>({})
  const [enviado, setEnviado] = React.useState<Record<number, string>>({})
  const [copiado, setCopiado] = React.useState<number | null>(null)
  const origin = typeof window !== "undefined" ? window.location.origin : ""

  function setFila(key: number, patch: Partial<FirmanteInput>) {
    setFirmantes((prev) => prev.map((f) => (f._key === key ? { ...f, ...patch } : f)))
  }

  async function crear() {
    setPaso("creando")
    try {
      const pdf = await generarPdf()
      const res = await solicitarFirma({
        entidad,
        entidad_id: entidadId ?? null,
        titulo,
        pdf,
        firmantes: firmantes.map(({ _key: _k, ...f }) => f),
        vence_dias: Number(venceDias) || 0,
        mensaje,
      })
      if (res.error || !res.data) {
        toast({ title: "No se pudo crear la solicitud", description: res.error ?? "", variant: "destructive" })
        setPaso("form")
        return
      }
      setDoc(res.data)
      setPaso("listo")
      onCreado?.(res.data)
      // Envía correos a quienes tengan correo (best-effort; si no hay Resend, queda el link).
      for (const f of res.data.firmas) {
        if (f.correo) enviar(f.id)
      }
    } catch (err) {
      toast({ title: "No se pudo generar el PDF", description: err instanceof Error ? err.message : "", variant: "destructive" })
      setPaso("form")
    }
  }

  async function enviar(firmaId: number) {
    setEnviando((p) => ({ ...p, [firmaId]: true }))
    const r = await enviarCorreoFirma(firmaId)
    setEnviando((p) => ({ ...p, [firmaId]: false }))
    setEnviado((p) => ({ ...p, [firmaId]: r.enviado ? "Correo enviado" : r.motivo || "No enviado" }))
  }

  async function copiar(firmaId: number, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(firmaId)
      setTimeout(() => setCopiado(null), 1500)
    } catch {
      toast({ title: "Copia el enlace manualmente", description: url })
    }
  }

  if (paso === "listo" && doc) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border bg-emerald-50 border-emerald-200 p-3 text-sm text-emerald-800">
          Solicitud creada. Folio <strong>{doc.folio}</strong>. Comparte cada enlace con su firmante (o revisa el correo enviado).
        </div>
        <div className="space-y-2">
          {doc.firmas.map((f) => {
            const url = urlFirma(origin, f.token)
            return (
              <div key={f.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{f.nombre} <Badge variant="outline" className="ml-1 text-[10px]">{f.rol}</Badge></p>
                    <p className="text-xs text-muted-foreground truncate">{f.correo || "sin correo"}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => copiar(f.id, url)}>{copiado === f.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copiar link</Button>
                    {f.correo && <Button size="sm" variant="outline" className="gap-1" onClick={() => enviar(f.id)} disabled={enviando[f.id]}>{enviando[f.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Correo</Button>}
                    {f.rol === "interno" && <Button size="sm" asChild className="gap-1"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Firmar</a></Button>}
                  </div>
                </div>
                <p className="text-[11px] font-mono text-muted-foreground break-all">{url}</p>
                {enviado[f.id] && <p className="text-xs text-muted-foreground">{enviado[f.id]}</p>}
              </div>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">Verificación pública: <a className="underline" href={urlVerificacion(origin, doc.folio)} target="_blank" rel="noreferrer">{urlVerificacion(origin, doc.folio)}</a></p>
        <DialogFooter>
          <Button variant="outline" asChild><Link href="/documentos/firmas">Ver bandeja</Link></Button>
          <Button onClick={() => onOpenChange(false)}>Listo</Button>
        </DialogFooter>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Firmantes</Label>
        {firmantes.map((f) => (
          <div key={f._key} className="grid grid-cols-[1fr_1fr_110px_32px] gap-2 items-center">
            <Input placeholder="Nombre completo" value={f.nombre} onChange={(e) => setFila(f._key, { nombre: e.target.value })} />
            <Input type="email" placeholder="correo (opcional)" value={f.correo ?? ""} onChange={(e) => setFila(f._key, { correo: e.target.value })} />
            <Select value={f.rol ?? "externo"} onValueChange={(v) => setFila(f._key, { rol: v as RolFirmante })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="externo">Externo</SelectItem><SelectItem value="interno">Interno</SelectItem></SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFirmantes((p) => (p.length > 1 ? p.filter((x) => x._key !== f._key) : p))} disabled={firmantes.length <= 1}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setFirmantes((p) => [...p, nuevaFila()])}><Plus className="h-4 w-4" /> Agregar firmante</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <div className="space-y-1">
          <Label>Vence en (días)</Label>
          <Input type="number" min={0} value={venceDias} onChange={(e) => setVenceDias(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Mensaje para el firmante (opcional)</Label>
          <Textarea rows={2} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Ej. Adjunto la cotización acordada; favor firmar para iniciar." />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Se genera el PDF, se guarda en el bucket privado con su hash SHA-256 y cada firmante recibe un enlace único. Firma electrónica simple (Decreto 149-2013).</p>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={paso === "creando"}>Cancelar</Button>
        <Button onClick={crear} disabled={paso === "creando" || firmantes.every((f) => !f.nombre.trim())} className="gap-1">
          {paso === "creando" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />} Crear solicitud
        </Button>
      </DialogFooter>
    </div>
  )
}

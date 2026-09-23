"use client"

import * as React from "react"
import { SlidersHorizontal, Save, RotateCcw, Plus, Trash2, Loader2, AlertTriangle, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { getHistorialParametros, saveParametros, deleteParametros, type VersionParametros } from "@/lib/services/rrhh"
import { PARAMETROS_2026, ETIQUETAS_PARAMETROS, normalizarParametros, calcularIHSS, calcularRAP, calcularISRMensual, type ParametrosNomina, type TramoISR } from "@/lib/services/nomina"

const GRUPOS: { titulo: string; claves: (keyof typeof ETIQUETAS_PARAMETROS)[] }[] = [
  { titulo: "IHSS", claves: ["ihss_em_empleado_pct", "ihss_em_patrono_pct", "ihss_ivm_empleado_pct", "ihss_ivm_patrono_pct", "ihss_techo_em", "ihss_techo_ivm"] },
  { titulo: "RAP", claves: ["rap_empleado_pct", "rap_patrono_pct", "rap_piso", "rap_techo"] },
  { titulo: "ISR y jornada", claves: ["isr_deduccion_medica_anual", "recargo_extra_diurna_pct", "recargo_extra_mixta_pct", "recargo_extra_nocturna_pct", "horas_jornada_diaria", "dias_mes", "salario_minimo_referencia"] },
]

export default function ParametrosRrhhPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { ready, razonSocialId } = useTenant()
  const esAdmin = (user?.rol || "").trim().toLowerCase() === "admin"
  const hoy = getHondurasTodayISODate()
  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState<string | null>(null)
  const [historial, setHistorial] = React.useState<VersionParametros[]>([])
  const [vigenteDesde, setVigenteDesde] = React.useState(`${hoy.slice(0, 4)}-01-01`)
  const [nombre, setNombre] = React.useState("")
  const [p, setP] = React.useState<ParametrosNomina>(normalizarParametros(null))
  const [saving, setSaving] = React.useState(false)
  const [ejemplo, setEjemplo] = React.useState("20000")

  async function cargar() {
    const res = await getHistorialParametros()
    if (res.pendiente) setPendiente(res.error)
    else if (res.error) toast({ title: "No se pudieron cargar los parámetros", description: res.error, variant: "destructive" })
    setHistorial(res.data)
    return res.data
  }

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    getHistorialParametros().then((res) => {
      if (!activo) return
      if (res.pendiente) setPendiente(res.error)
      setHistorial(res.data)
      const h = getHondurasTodayISODate()
      const vig = res.data.find((v) => v.vigente_desde <= h) ?? res.data[0]
      if (vig) {
        setVigenteDesde(vig.vigente_desde)
        setNombre(vig.nombre || "")
        setP(normalizarParametros(vig.parametros))
      }
      setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId])

  function cargarVersion(v: VersionParametros) {
    setVigenteDesde(v.vigente_desde)
    setNombre(v.nombre || "")
    setP(normalizarParametros(v.parametros))
  }

  async function guardar() {
    setSaving(true)
    const res = await saveParametros({ vigente_desde: vigenteDesde, nombre, parametros: p as unknown as Record<string, unknown> })
    setSaving(false)
    if (res.error) return toast({ title: "No se pudo guardar", description: res.error, variant: "destructive" })
    toast({ title: "Parámetros guardados", description: `Rigen desde ${formatHondurasDate(vigenteDesde)}` })
    cargar()
  }

  async function eliminar(v: VersionParametros) {
    if (!window.confirm(`¿Eliminar la versión vigente desde ${formatHondurasDate(v.vigente_desde)}?`)) return
    const res = await deleteParametros(v.id)
    if (!res.success) return toast({ title: "No se pudo eliminar", description: res.error ?? "", variant: "destructive" })
    cargar()
  }

  const setNum = (k: keyof typeof ETIQUETAS_PARAMETROS, v: string) => setP((prev) => ({ ...prev, [k]: Number(v) || 0 }))
  const setTramo = (i: number, patch: Partial<TramoISR>) => setP((prev) => ({ ...prev, isr_tramos: prev.isr_tramos.map((t, j) => (j === i ? { ...t, ...patch } : t)) }))

  const sal = Number(ejemplo) || 0
  const ihss = calcularIHSS(sal, p)
  const rap = calcularRAP(sal, p)
  const isr = calcularISRMensual({ salarioMensualGravable: sal, ihssEmpleadoMensual: ihss.empleado }, p)

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><SlidersHorizontal className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Parámetros de nómina</h1>
            <p className="text-sm text-muted-foreground">IHSS, RAP, tabla ISR y recargos, versionados por fecha de vigencia. Valores 2026 de referencia: valídalos con tu contador.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setP(normalizarParametros(null))} className="gap-1"><RotateCcw className="h-4 w-4" /> Valores 2026</Button>
          <Button size="sm" onClick={guardar} disabled={saving || !esAdmin || !!pendiente} className="gap-1">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar versión</Button>
        </div>
      </div>

      {pendiente && <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {pendiente}</CardContent></Card>}
      {!esAdmin && <Card className="border-stone-200 bg-stone-50"><CardContent className="p-3 text-xs text-muted-foreground">Solo un administrador puede guardar cambios.</CardContent></Card>}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 grid gap-3 sm:grid-cols-[180px_1fr]">
              <div className="space-y-1"><Label>Vigente desde</Label><Input type="date" value={vigenteDesde} onChange={(e) => setVigenteDesde(e.target.value)} /></div>
              <div className="space-y-1"><Label>Nombre de la versión</Label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Tabla SAR 2026 / techos IHSS enero 2026" /></div>
            </CardContent>
          </Card>
          {GRUPOS.map((g) => (
            <Card key={g.titulo}>
              <CardHeader className="p-4 pb-2"><CardTitle className="text-base">{g.titulo}</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.claves.map((k) => (
                  <div key={k} className="space-y-1"><Label className="text-xs">{ETIQUETAS_PARAMETROS[k]}</Label><Input type="number" step="0.01" value={p[k]} onChange={(e) => setNum(k, e.target.value)} /></div>
                ))}
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Tabla progresiva ISR (renta neta gravable anual)</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <Table>
                <TableHeader><TableRow><TableHead>Desde</TableHead><TableHead>Hasta (vacío = en adelante)</TableHead><TableHead className="w-28">Tasa %</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {p.isr_tramos.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm text-muted-foreground">{i === 0 ? formatCurrency(0) : formatCurrency((p.isr_tramos[i - 1].hasta ?? 0) + 0.01)}</TableCell>
                      <TableCell><Input type="number" step="0.01" value={t.hasta ?? ""} onChange={(e) => setTramo(i, { hasta: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
                      <TableCell><Input type="number" step="0.01" value={t.pct} onChange={(e) => setTramo(i, { pct: Number(e.target.value) || 0 })} /></TableCell>
                      <TableCell><Button variant="ghost" size="icon" className="h-8 w-8 text-red-700" onClick={() => setP((prev) => ({ ...prev, isr_tramos: prev.isr_tramos.filter((_, j) => j !== i) }))} disabled={p.isr_tramos.length <= 1}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setP((prev) => ({ ...prev, isr_tramos: [...prev.isr_tramos, { hasta: null, pct: 25 }] }))}><Plus className="h-4 w-4" /> Agregar tramo</Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Simulador (mensual)</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2 text-sm">
              <div className="space-y-1"><Label>Salario mensual</Label><Input type="number" value={ejemplo} onChange={(e) => setEjemplo(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1">
                <span className="text-muted-foreground">IHSS empleado</span><span className="text-right font-mono">{formatCurrency(ihss.empleado)}</span>
                <span className="text-muted-foreground">RAP empleado</span><span className="text-right font-mono">{formatCurrency(rap.empleado)}</span>
                <span className="text-muted-foreground">ISR</span><span className="text-right font-mono">{formatCurrency(isr)}</span>
                <span className="font-medium">Neto</span><span className="text-right font-mono font-semibold">{formatCurrency(sal - ihss.empleado - rap.empleado - isr)}</span>
                <span className="text-muted-foreground pt-1">IHSS patronal</span><span className="text-right font-mono pt-1">{formatCurrency(ihss.patrono)}</span>
                <span className="text-muted-foreground">RAP patronal</span><span className="text-right font-mono">{formatCurrency(rap.patrono)}</span>
                <span className="font-medium">Costo empresa</span><span className="text-right font-mono font-semibold">{formatCurrency(sal + ihss.patrono + rap.patrono)}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-2"><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Versiones</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-1">
              {historial.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 text-sm border-b last:border-0 py-1.5">
                  <button className="text-left hover:underline" onClick={() => cargarVersion(v)}>
                    <span className="font-medium">{formatHondurasDate(v.vigente_desde)}</span>{v.vigente_desde <= hoy && v === (historial.find((x) => x.vigente_desde <= hoy) ?? null) && <span className="ml-1 text-[10px] rounded bg-emerald-100 text-emerald-800 px-1">vigente</span>}
                    <span className="block text-xs text-muted-foreground">{v.nombre || "sin nombre"}</span>
                  </button>
                  {esAdmin && <Button variant="ghost" size="icon" className="h-7 w-7 text-red-700" onClick={() => eliminar(v)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                </div>
              ))}
              {historial.length === 0 && <p className="text-xs text-muted-foreground">Sin versiones guardadas: la nómina usa los valores 2026 por defecto ({formatCurrency(PARAMETROS_2026.ihss_techo_em)} de techo IHSS).</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

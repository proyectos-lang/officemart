"use client"

import { useMemo } from "react"
import { Loader2, Save, AlertTriangle, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import {
  formatearCorrelativoCai,
  foliosRestantes,
  fechaLimiteVencida,
  tipoDocumentoLabel,
  type ConfigCai,
} from "@/lib/services/facturacion-cai"

/**
 * Formulario de una autorización CAI (un tipo de documento). Lo comparten
 * Configuración → Facturación CAI (empresa sin puntos, punto 0) y
 * Configuración → Puntos de Facturación (CAI por punto, script officemart-004).
 * `contexto` solo cambia el subtítulo (p.ej. el nombre del punto).
 */
export function ConfigCaiForm({
  cfg,
  onChange,
  onSave,
  saving,
  contexto,
}: {
  cfg: ConfigCai
  onChange: (c: Partial<ConfigCai>) => void
  onSave: () => void
  saving: boolean
  contexto?: string | null
}) {
  const hoy = getHondurasTodayISODate()
  const restantes = foliosRestantes(cfg)
  const vencida = fechaLimiteVencida(cfg.fecha_limite_emision, hoy)
  // Los ids de los inputs incluyen el punto para que dos formularios de la
  // misma pestaña (distinto punto) no compartan `htmlFor`.
  const k = `${cfg.punto_facturacion_id ?? 0}-${cfg.tipo_documento}`

  const previewActual = useMemo(
    () => formatearCorrelativoCai(cfg.establecimiento, cfg.punto_emision, cfg.tipo_documento, cfg.correlativo_actual),
    [cfg.establecimiento, cfg.punto_emision, cfg.tipo_documento, cfg.correlativo_actual]
  )
  const previewInicial = formatearCorrelativoCai(cfg.establecimiento, cfg.punto_emision, cfg.tipo_documento, cfg.rango_inicial)
  const previewFinal = formatearCorrelativoCai(cfg.establecimiento, cfg.punto_emision, cfg.tipo_documento, cfg.rango_final)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {tipoDocumentoLabel(cfg.tipo_documento)} · Autorización del SAR
          {contexto ? <span className="text-muted-foreground font-normal"> · {contexto}</span> : null}
        </CardTitle>
        <CardDescription>
          Estos datos vienen de tu autorización de impresión del SAR (CAI). El nombre, RTN, dirección y teléfono del
          encabezado se toman de <strong>Configuración → Razón Social</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Avisos */}
        {vencida && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>La fecha límite de emisión ya venció. Solicita una nueva autorización al SAR antes de facturar.</span>
          </div>
        )}
        {!vencida && cfg.rango_final > 0 && restantes <= 20 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Quedan {restantes} folios en el rango autorizado. Gestiona una nueva autorización pronto.</span>
          </div>
        )}

        {/* CAI */}
        <div className="grid gap-2">
          <Label htmlFor={`cai-${k}`}>Clave de Autorización de Impresión (CAI)</Label>
          <Input
            id={`cai-${k}`}
            value={cfg.cai}
            onChange={(e) => onChange({ cai: e.target.value })}
            placeholder="000000-000000-000000-000000-000000-00"
            className="font-mono"
          />
        </div>

        {/* Establecimiento / Punto / Preview */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor={`estab-${k}`}>Establecimiento</Label>
            <Input
              id={`estab-${k}`}
              value={cfg.establecimiento}
              onChange={(e) => onChange({ establecimiento: e.target.value.replace(/\D/g, "").slice(0, 3) })}
              placeholder="000"
              inputMode="numeric"
              className="font-mono"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`punto-${k}`}>Punto de emisión</Label>
            <Input
              id={`punto-${k}`}
              value={cfg.punto_emision}
              onChange={(e) => onChange({ punto_emision: e.target.value.replace(/\D/g, "").slice(0, 3) })}
              placeholder="001"
              inputMode="numeric"
              className="font-mono"
            />
          </div>
          <div className="grid gap-2">
            <Label>Tipo de documento</Label>
            <Input value={`${cfg.tipo_documento} · ${tipoDocumentoLabel(cfg.tipo_documento)}`} disabled className="font-mono" />
          </div>
        </div>

        <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Info className="h-4 w-4" /> Así se verá el número de factura:
          </div>
          <p className="mt-1 font-mono text-base text-stone-800">{previewActual}</p>
        </div>

        {/* Rango autorizado */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor={`ri-${k}`}>Correlativo inicial</Label>
            <Input
              id={`ri-${k}`}
              type="number"
              min={1}
              value={cfg.rango_inicial}
              onChange={(e) => onChange({ rango_inicial: Number(e.target.value) })}
            />
            <p className="font-mono text-[11px] text-muted-foreground">{previewInicial}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`rf-${k}`}>Correlativo final</Label>
            <Input
              id={`rf-${k}`}
              type="number"
              min={0}
              value={cfg.rango_final}
              onChange={(e) => onChange({ rango_final: Number(e.target.value) })}
            />
            <p className="font-mono text-[11px] text-muted-foreground">{previewFinal}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`ca-${k}`}>Siguiente correlativo a emitir</Label>
            <Input
              id={`ca-${k}`}
              type="number"
              min={1}
              value={cfg.correlativo_actual}
              onChange={(e) => onChange({ correlativo_actual: Number(e.target.value) })}
            />
            <p className="text-[11px] text-muted-foreground">
              {cfg.rango_final > 0 ? `${restantes} folios restantes` : "Define el rango para ver los folios"}
            </p>
          </div>
        </div>

        {/* Fecha límite */}
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor={`fl-${k}`}>Fecha límite de emisión</Label>
          <Input
            id={`fl-${k}`}
            type="date"
            value={cfg.fecha_limite_emision ?? ""}
            onChange={(e) => onChange({ fecha_limite_emision: e.target.value || null })}
          />
        </div>

        {/* Imprenta (modalidad por imprenta) */}
        <div className="space-y-4 rounded-md border border-stone-200 p-4">
          <p className="text-sm font-medium text-stone-700">Datos de la imprenta (opcional)</p>
          <p className="text-xs text-muted-foreground">
            Solo si emites por imprenta (formatos preimpresos). En modalidad de autoimpresor puedes dejarlos vacíos.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor={`in-${k}`}>Nombre / razón social</Label>
              <Input
                id={`in-${k}`}
                value={cfg.imprenta_nombre}
                onChange={(e) => onChange({ imprenta_nombre: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`ir-${k}`}>RTN</Label>
              <Input
                id={`ir-${k}`}
                value={cfg.imprenta_rtn}
                onChange={(e) => onChange({ imprenta_rtn: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`ig-${k}`}>N.º de registro (RFI)</Label>
              <Input
                id={`ig-${k}`}
                value={cfg.imprenta_registro}
                onChange={(e) => onChange({ imprenta_registro: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Activo + Guardar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <Switch checked={cfg.activo} onCheckedChange={(v) => onChange({ activo: v })} />
            Autorización activa
          </label>
          <Button onClick={onSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

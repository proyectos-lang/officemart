"use client"

import * as React from "react"
import {
  Upload, FileDown, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils/format"
import {
  getAlmacenes, getLocalizaciones, type Almacen, type Localizacion,
} from "@/lib/services/catalogos"
import {
  parsearArchivoProductos, previsualizarImportProductos, importarProductos, descargarPlantillaProductos,
  type FilaProductoImport, type PreviewProductos, type ResultadoImportProductos,
} from "@/lib/services/importar-productos"

export function ImportarProductosDialog({ onImported }: { onImported: () => void }) {
  const { toast } = useToast()

  const [open, setOpen] = React.useState(false)
  const [almacenes, setAlmacenes] = React.useState<Almacen[]>([])
  const [localizaciones, setLocalizaciones] = React.useState<Localizacion[]>([])
  const [almacenId, setAlmacenId] = React.useState("")
  const [localizacionId, setLocalizacionId] = React.useState("")

  const [filas, setFilas] = React.useState<FilaProductoImport[]>([])
  const [nombreArchivo, setNombreArchivo] = React.useState("")
  const [preview, setPreview] = React.useState<PreviewProductos | null>(null)
  const [parsing, setParsing] = React.useState(false)
  const [descargandoPlantilla, setDescargandoPlantilla] = React.useState(false)
  const [importando, setImportando] = React.useState(false)
  const [resultado, setResultado] = React.useState<ResultadoImportProductos | null>(null)
  // Para los productos que ya existen: generar el ingreso de inventario a sus
  // existencias (true) o solo omitirlos (false, por defecto).
  const [generarIngresoDup, setGenerarIngresoDup] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    getAlmacenes().then((r) => {
      const arr = r.data || []
      setAlmacenes(arr)
      if (arr.length === 1 && arr[0]?.id) setAlmacenId(String(arr[0].id))
    })
  }, [open])

  React.useEffect(() => {
    if (!almacenId) { setLocalizaciones([]); setLocalizacionId(""); return }
    getLocalizaciones(Number(almacenId)).then((r) => {
      setLocalizaciones(r.data || [])
      setLocalizacionId((r.data || []).length === 1 ? String(r.data[0].id) : "")
    })
  }, [almacenId])

  function resetArchivo() {
    setFilas([]); setNombreArchivo(""); setPreview(null); setResultado(null); setGenerarIngresoDup(false)
  }
  function resetTodo() {
    resetArchivo()
    setAlmacenId(""); setLocalizacionId("")
  }

  async function descargarPlantilla() {
    setDescargandoPlantilla(true)
    try {
      await descargarPlantillaProductos()
    } catch {
      toast({ title: "Error", description: "No se pudo generar la plantilla.", variant: "destructive" })
    } finally {
      setDescargandoPlantilla(false)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParsing(true)
    setResultado(null)
    try {
      const parsed = await parsearArchivoProductos(file)
      if (parsed.length === 0) {
        toast({ title: "Archivo vacío", description: "No se encontraron productos válidos.", variant: "destructive" })
        resetArchivo()
        return
      }
      setFilas(parsed)
      setNombreArchivo(file.name)
      setPreview(await previsualizarImportProductos(parsed))
    } catch {
      toast({ title: "Error", description: "No se pudo leer el archivo. Verifica que sea un Excel válido.", variant: "destructive" })
      resetArchivo()
    } finally {
      setParsing(false)
      e.target.value = "" // permite volver a elegir el mismo archivo
    }
  }

  const requiereInventario =
    (preview?.unidadesIniciales ?? 0) > 0 ||
    (generarIngresoDup && (preview?.unidadesDuplicados ?? 0) > 0)
  const hayAlgoQueHacer =
    !!preview && (preview.nuevos > 0 || (generarIngresoDup && preview.duplicadosConCantidad > 0))
  const listoParaImportar =
    hayAlgoQueHacer && (!requiereInventario || (!!almacenId && !!localizacionId))

  async function ejecutar() {
    if (!listoParaImportar) return
    setImportando(true)
    try {
      const res = await importarProductos(filas, {
        almacen_id: almacenId ? Number(almacenId) : 0,
        localizacion_id: localizacionId ? Number(localizacionId) : 0,
        generarIngresoADuplicados: generarIngresoDup,
      })
      if (res.error || !res.data) {
        toast({ title: "No se pudo cargar", description: res.error || "Error desconocido", variant: "destructive" })
        return
      }
      setResultado(res.data)
      if (res.data.creados > 0) {
        toast({ title: "Carga completada", description: `${res.data.creados} producto(s) creado(s).` })
        onImported()
      }
    } finally {
      setImportando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!importando) { setOpen(o); if (!o) resetTodo() } }}>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" /> Carga masiva
      </Button>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Carga masiva de productos</DialogTitle>
          <DialogDescription>
            Descarga la plantilla, complétala con tus productos (precio, costo y cantidad inicial) y súbela.
            El sistema crea cada producto y genera su inventario inicial en el almacén y bodega elegidos.
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          // ---------- RESULTADO ----------
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border p-3 bg-emerald-50/60">
                <p className="text-2xl font-bold text-emerald-700">{resultado.creados}</p>
                <p className="text-xs text-stone-500">Creados</p>
              </div>
              <div className="rounded-lg border p-3 bg-amber-50/60">
                <p className="text-2xl font-bold text-amber-700">{resultado.omitidos}</p>
                <p className="text-xs text-stone-500">Omitidos</p>
              </div>
              <div className="rounded-lg border p-3 bg-red-50/60">
                <p className="text-2xl font-bold text-red-700">{resultado.errores}</p>
                <p className="text-xs text-stone-500">Con error</p>
              </div>
            </div>
            <p className="text-sm text-center text-stone-600">
              {resultado.conInventario} con inventario
              {resultado.ingresosExistentes > 0 ? ` · ${resultado.ingresosExistentes} ingreso(s) a existentes` : ""}
              {resultado.sinInventario > 0 ? ` · ${resultado.sinInventario} sin inventario` : ""}
            </p>
            {resultado.productos.some((p) => p.estado !== "creado" && p.estado !== "ingreso_existente") && (
              <ScrollArea className="h-40 rounded-md border">
                <div className="p-2 space-y-1">
                  {resultado.productos.filter((p) => p.estado !== "creado" && p.estado !== "ingreso_existente").map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Badge
                        variant="secondary"
                        className={
                          p.estado === "omitido"
                            ? "bg-amber-100 text-amber-700"
                            : p.estado === "sin_inventario"
                              ? "bg-orange-100 text-orange-700"
                              : "bg-red-100 text-red-700"
                        }
                      >
                        {p.identificador}
                      </Badge>
                      <span className="text-stone-600">{p.detalle}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={resetArchivo}>Cargar otro archivo</Button>
              <Button onClick={() => { setOpen(false); resetTodo() }}>Cerrar</Button>
            </DialogFooter>
          </div>
        ) : (
          // ---------- CONFIGURACION ----------
          <div className="space-y-4">
            {/* Paso 1: almacen + bodega para el inventario inicial */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Almacén (inventario inicial)</Label>
                <Select value={almacenId} onValueChange={setAlmacenId}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    {almacenes.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Bodega / Localización</Label>
                <Select value={localizacionId} onValueChange={setLocalizacionId} disabled={!almacenId}>
                  <SelectTrigger><SelectValue placeholder={almacenId ? "Seleccionar" : "Elige almacén"} /></SelectTrigger>
                  <SelectContent>
                    {localizaciones.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              El almacén y la bodega solo se usan para las filas con <strong>Cantidad Inicial</strong> mayor a 0.
            </p>

            {/* Paso 2: archivo */}
            <div className="rounded-lg border border-dashed p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={descargarPlantilla} disabled={descargandoPlantilla}>
                  {descargandoPlantilla ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                  Descargar plantilla
                </Button>
                <label className="inline-flex">
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
                  <span className="inline-flex items-center gap-2 text-sm font-medium border rounded-md px-3 py-1.5 cursor-pointer hover:bg-stone-50">
                    {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    {parsing ? "Leyendo…" : "Elegir archivo"}
                  </span>
                </label>
              </div>

              {nombreArchivo && preview && (
                <div className="text-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    <span className="font-medium">{nombreArchivo}</span>
                    <button className="ml-auto text-stone-400 hover:text-stone-600" onClick={resetArchivo}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded bg-stone-50 p-2"><p className="font-bold">{preview.nuevos}</p><p className="text-xs text-stone-500">Nuevos</p></div>
                    <div className="rounded bg-stone-50 p-2"><p className="font-bold">{preview.unidadesIniciales}</p><p className="text-xs text-stone-500">Unidades</p></div>
                    <div className="rounded bg-stone-50 p-2"><p className="font-bold">{formatCurrency(preview.valorInventarioInicial)}</p><p className="text-xs text-stone-500">Valor inv.</p></div>
                  </div>

                  {preview.duplicados.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {preview.duplicados.length} ya existen: {preview.duplicados.slice(0, 8).join(", ")}{preview.duplicados.length > 8 ? "…" : ""}
                    </p>
                  )}
                  {preview.duplicadosConCantidad > 0 && (
                    <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                      <div>
                        <Label className="text-sm">
                          {preview.duplicadosConCantidad === 1
                            ? "Este producto ya existe. ¿Deseas generar el ingreso de inventario?"
                            : `${preview.duplicadosConCantidad} productos ya existen. ¿Deseas generar su ingreso de inventario?`}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {generarIngresoDup
                            ? `Sumará ${preview.unidadesDuplicados} u. a las existencias actuales (no crea duplicados).`
                            : "Si lo activas, suma sus cantidades a las existencias. Si no, se omiten."}
                        </p>
                      </div>
                      <Switch checked={generarIngresoDup} onCheckedChange={setGenerarIngresoDup} />
                    </div>
                  )}
                  {preview.sinNombre > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-red-700">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {preview.sinNombre} fila(s) sin nombre se ignorarán.
                    </p>
                  )}
                  {(preview.categoriasNoEncontradas.length > 0 || preview.marcasNoEncontradas.length > 0 || (preview.lineasNoEncontradas?.length ?? 0) > 0) && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      Sin coincidencia (se crearán sin ese dato):{" "}
                      {[...preview.categoriasNoEncontradas.map((c) => `cat. ${c}`), ...preview.marcasNoEncontradas.map((m) => `marca ${m}`), ...(preview.lineasNoEncontradas ?? []).map((l) => `línea ${l}`)].slice(0, 6).join(", ")}
                    </p>
                  )}
                  {requiereInventario && (!almacenId || !localizacionId) && (
                    <p className="flex items-start gap-1.5 text-xs text-red-700">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      Selecciona almacén y bodega para el inventario inicial.
                    </p>
                  )}
                  {preview.nuevos > 0 && (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Se crearán {preview.nuevos} producto(s) nuevo(s).
                    </p>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); resetTodo() }} disabled={importando}>Cancelar</Button>
              <Button onClick={ejecutar} disabled={!listoParaImportar || importando} className="gap-2">
                {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {importando ? "Cargando…" : "Cargar"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

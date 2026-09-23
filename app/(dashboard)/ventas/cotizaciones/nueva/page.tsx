"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  FileText, ArrowLeft, Save, Loader2, Plus, Trash2, Search, ChevronsUpDown, Check, Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency } from "@/lib/utils/format"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { getClientes, getProductos, type Cliente, type Producto } from "@/lib/services/catalogos"
import { getVendedores, getVendedorDeUsuario, type Vendedor } from "@/lib/services/vendedores"
import { getPuntosFacturacion, resolverPuntoVenta } from "@/lib/services/puntos-facturacion"
import { getListaAplicadaCliente, calcularPrecioLista, type ListaAplicada } from "@/lib/services/listas-precios"
import {
  getCotizacion, crearCotizacion, actualizarCotizacion, calcularTotalesCotizacion, esEditable, fechaMasDias,
  type CotizacionLinea, type EstadoCotizacion,
} from "@/lib/services/cotizaciones"

type LineaEditor = Omit<CotizacionLinea, "subtotal" | "id" | "orden"> & { _key: string }

let seq = 0
const nuevaKey = () => `l-${Date.now()}-${++seq}`

export default function CotizacionEditorPage() {
  return (
    <React.Suspense fallback={<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>}>
      <CotizacionEditor />
    </React.Suspense>
  )
}

function CotizacionEditor() {
  const router = useRouter()
  const params = useSearchParams()
  const editId = params.get("id") ? Number(params.get("id")) : null
  const { toast } = useToast()
  const { user, hasModulo } = useAuth()
  const { ready, razonSocialId } = useTenant()
  const usaVendedores = hasModulo("Vendedores y Zonas")
  const usaListas = hasModulo("Listas de Precios")
  const hoy = getHondurasTodayISODate()

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [clientes, setClientes] = React.useState<Cliente[]>([])
  const [productos, setProductos] = React.useState<Producto[]>([])
  const [vendedores, setVendedores] = React.useState<Vendedor[]>([])

  // Encabezado
  const [numero, setNumero] = React.useState<string | null>(null)
  const [estado, setEstado] = React.useState<EstadoCotizacion>("Borrador")
  const [clienteId, setClienteId] = React.useState<number | null>(null)
  const [clienteNombre, setClienteNombre] = React.useState("")
  const [clienteOpen, setClienteOpen] = React.useState(false)
  const [vendedorId, setVendedorId] = React.useState<string>("")
  const [puntoId, setPuntoId] = React.useState<number | null>(null)
  const [vigencia, setVigencia] = React.useState(fechaMasDias(hoy, 15))
  const [aplicaIsv, setAplicaIsv] = React.useState(false)
  const [descuento, setDescuento] = React.useState("0")
  const [notas, setNotas] = React.useState("")
  const [condiciones, setCondiciones] = React.useState("")
  const [lineas, setLineas] = React.useState<LineaEditor[]>([])
  const [listaAplicada, setListaAplicada] = React.useState<ListaAplicada | null>(null)

  // Agregar producto / línea libre
  const [prodOpen, setProdOpen] = React.useState(false)
  const [prodBusqueda, setProdBusqueda] = React.useState("")
  const [libreDesc, setLibreDesc] = React.useState("")
  const [libreCant, setLibreCant] = React.useState("1")
  const [librePrecio, setLibrePrecio] = React.useState("")

  const soloLectura = editId != null && !esEditable(estado)

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId, editId])

  async function cargar() {
    setLoading(true)
    const [cRes, pRes, vRes, vendUsuario, puntosRes] = await Promise.all([
      getClientes({ soloActivos: true }),
      getProductos(),
      usaVendedores ? getVendedores({ soloActivos: true }) : Promise.resolve({ data: [] as Vendedor[], error: null }),
      usaVendedores ? getVendedorDeUsuario(user?.auth_user_id) : Promise.resolve(null),
      getPuntosFacturacion({ soloActivos: true }),
    ])
    setClientes(cRes.data || [])
    setProductos(pRes.data || [])
    setVendedores(vRes.data || [])
    setPuntoId(resolverPuntoVenta(user, puntosRes.data || [])?.id ?? null)

    if (editId != null) {
      const { data, error } = await getCotizacion(editId)
      if (error || !data) {
        toast({ title: "No se pudo abrir la cotización", description: error ?? "", variant: "destructive" })
        router.push("/ventas/cotizaciones")
        return
      }
      const e = data.encabezado
      setNumero(e.numero)
      setEstado(e.estado)
      setClienteId(e.cliente_id)
      setClienteNombre(e.cliente_nombre || "")
      setVendedorId(e.vendedor_id != null ? String(e.vendedor_id) : "")
      if (e.punto_facturacion_id != null) setPuntoId(e.punto_facturacion_id)
      setVigencia(e.vigencia_hasta || "")
      setAplicaIsv(e.aplica_impuesto)
      setDescuento(String(e.descuento || 0))
      setNotas(e.notas || "")
      setCondiciones(e.condiciones || "")
      setLineas(data.lineas.map((l) => ({
        _key: nuevaKey(),
        producto_id: l.producto_id,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario,
        descuento_linea: l.descuento_linea,
      })))
    } else if (vendUsuario?.id != null) {
      setVendedorId(String(vendUsuario.id))
    }
    setLoading(false)
  }

  // Lista de precios del cliente (para preciar los productos que se agreguen).
  React.useEffect(() => {
    if (!usaListas || clienteId == null) { setListaAplicada(null); return }
    getListaAplicadaCliente(clienteId).then((r) => setListaAplicada(r.data))
  }, [clienteId, usaListas])

  const totales = React.useMemo(
    () => calcularTotalesCotizacion(lineas, Number(descuento) || 0, aplicaIsv),
    [lineas, descuento, aplicaIsv]
  )

  const productosFiltrados = React.useMemo(() => {
    const q = prodBusqueda.trim().toLowerCase()
    const base = q
      ? productos.filter((p) => (p.nombre || "").toLowerCase().includes(q) || (p.codigo_barras || "").toLowerCase().includes(q))
      : productos
    return base.slice(0, 50)
  }, [productos, prodBusqueda])

  function elegirCliente(c: Cliente) {
    setClienteId(c.id ?? null)
    setClienteNombre(c.nombre)
    setClienteOpen(false)
    if (usaVendedores && c.vendedor_id != null && !vendedorId) setVendedorId(String(c.vendedor_id))
  }

  function agregarProducto(p: Producto) {
    const precio = calcularPrecioLista(p.precio_venta_sugerido || 0, listaAplicada, p)
    setLineas((prev) => {
      const i = prev.findIndex((l) => l.producto_id === p.id)
      if (i >= 0) return prev.map((l, idx) => (idx === i ? { ...l, cantidad: l.cantidad + 1 } : l))
      return [...prev, { _key: nuevaKey(), producto_id: p.id!, descripcion: p.nombre, cantidad: 1, precio_unitario: precio, descuento_linea: 0 }]
    })
    setProdOpen(false)
    setProdBusqueda("")
  }

  function agregarLibre() {
    const desc = libreDesc.trim()
    const precio = Number(librePrecio)
    const cant = Number(libreCant)
    if (!desc || !(precio >= 0) || !(cant > 0)) {
      toast({ title: "Completa descripción, cantidad y precio", variant: "destructive" })
      return
    }
    setLineas((prev) => [...prev, { _key: nuevaKey(), producto_id: null, descripcion: desc, cantidad: cant, precio_unitario: precio, descuento_linea: 0 }])
    setLibreDesc(""); setLibreCant("1"); setLibrePrecio("")
  }

  function actualizarLinea(key: string, cambios: Partial<LineaEditor>) {
    setLineas((prev) => prev.map((l) => (l._key === key ? { ...l, ...cambios } : l)))
  }

  async function guardar() {
    if (soloLectura) return
    if (clienteId == null && !clienteNombre.trim()) {
      toast({ title: "Falta el cliente", description: "Elige un cliente o escribe el nombre del prospecto.", variant: "destructive" })
      return
    }
    if (lineas.length === 0) {
      toast({ title: "Agrega al menos una línea", variant: "destructive" })
      return
    }
    setSaving(true)
    const input = {
      cliente_id: clienteId,
      cliente_nombre: clienteNombre,
      vendedor_id: usaVendedores && vendedorId ? Number(vendedorId) : null,
      punto_facturacion_id: puntoId,
      vigencia_hasta: vigencia || null,
      aplica_impuesto: aplicaIsv,
      descuento: Number(descuento) || 0,
      notas,
      condiciones,
      lineas: lineas.map(({ _key: _k, ...l }) => l),
    }
    const res = editId != null ? await actualizarCotizacion(editId, input) : await crearCotizacion(input)
    setSaving(false)
    if (res.error || !res.data) {
      toast({ title: "No se pudo guardar", description: res.error ?? "Intenta de nuevo.", variant: "destructive" })
      return
    }
    toast({ title: editId != null ? "Cotización actualizada" : "Cotización creada", description: res.data.numero })
    router.push("/ventas/cotizaciones")
  }

  if (loading) {
    return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>
  }

  const clienteSel = clientes.find((c) => c.id === clienteId) ?? null

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/ventas/cotizaciones")} aria-label="Volver">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="rounded-lg bg-sky-100 p-2 text-sky-700">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">
              {editId != null ? `Cotización ${numero ?? ""}` : "Nueva cotización"}
            </h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              {editId != null ? <Badge variant="outline">{estado}</Badge> : "El número COT-#### se asigna al guardar."}
              {soloLectura && <span className="inline-flex items-center gap-1 text-amber-700"><Lock className="h-3.5 w-3.5" /> Solo lectura: duplícala para cambiarla.</span>}
            </p>
          </div>
        </div>
        {!soloLectura && (
          <Button onClick={guardar} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Encabezado */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Datos</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <Label>Cliente</Label>
              <Popover open={clienteOpen} onOpenChange={setClienteOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="justify-between font-normal" disabled={soloLectura}>
                    <span className="truncate">{clienteSel ? clienteSel.nombre : clienteId == null && clienteNombre ? `${clienteNombre} (prospecto)` : "Elegir cliente…"}</span>
                    <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[320px]" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar cliente…" />
                    <CommandList>
                      <CommandEmpty>Sin resultados.</CommandEmpty>
                      <CommandGroup>
                        {clientes.map((c) => (
                          <CommandItem key={c.id} value={`${c.nombre} ${c.rtn || ""}`} onSelect={() => elegirCliente(c)}>
                            <Check className={`mr-2 h-4 w-4 ${c.id === clienteId ? "opacity-100" : "opacity-0"}`} />
                            <span className="truncate">{c.nombre}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Input
                value={clienteId == null ? clienteNombre : ""}
                onChange={(e) => { setClienteId(null); setClienteNombre(e.target.value) }}
                placeholder="…o nombre del prospecto (sin registrar)"
                disabled={soloLectura || clienteId != null}
              />
              {clienteId != null && !soloLectura && (
                <button type="button" className="text-xs text-muted-foreground underline text-left" onClick={() => { setClienteId(null); setClienteNombre("") }}>
                  Quitar cliente
                </button>
              )}
            </div>
            {usaVendedores && (
              <div className="grid gap-1.5">
                <Label>Vendedor</Label>
                <Select value={vendedorId || "__none__"} onValueChange={(v) => setVendedorId(v === "__none__" ? "" : v)} disabled={soloLectura}>
                  <SelectTrigger><SelectValue placeholder="Sin vendedor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin vendedor</SelectItem>
                    {vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Vigente hasta</Label>
              <Input type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} disabled={soloLectura} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Descuento global (%)</Label>
                <Input type="number" min="0" max="100" step="any" value={descuento} onChange={(e) => setDescuento(e.target.value)} disabled={soloLectura} />
              </div>
              <div className="grid gap-1.5">
                <Label>ISV 15 %</Label>
                <div className="h-9 flex items-center">
                  <Switch checked={aplicaIsv} onCheckedChange={setAplicaIsv} disabled={soloLectura} />
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Condiciones (van en el PDF)</Label>
              <Textarea rows={3} value={condiciones} onChange={(e) => setCondiciones(e.target.value)} placeholder="Forma de pago, tiempo de entrega, garantía…" disabled={soloLectura} />
            </div>
            <div className="grid gap-1.5">
              <Label>Notas internas</Label>
              <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} disabled={soloLectura} />
            </div>
          </CardContent>
        </Card>

        {/* Líneas */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Líneas ({lineas.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!soloLectura && (
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <Popover open={prodOpen} onOpenChange={setProdOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="justify-start font-normal gap-2">
                      <Search className="h-4 w-4 text-muted-foreground" /> Agregar producto del catálogo…
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[420px]" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="Nombre o código…" value={prodBusqueda} onValueChange={setProdBusqueda} />
                      <CommandList>
                        <CommandEmpty>Sin resultados.</CommandEmpty>
                        <CommandGroup>
                          {productosFiltrados.map((p) => (
                            <CommandItem key={p.id} value={String(p.id)} onSelect={() => agregarProducto(p)}>
                              <div className="flex-1 min-w-0">
                                <p className="truncate text-sm">{p.nombre}</p>
                                <p className="text-xs text-muted-foreground font-mono">{p.codigo_barras || "—"}</p>
                              </div>
                              <span className="text-sm font-medium ml-2">{formatCurrency(calcularPrecioLista(p.precio_venta_sugerido || 0, listaAplicada, p))}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <div className="flex gap-2">
                  <Input value={libreDesc} onChange={(e) => setLibreDesc(e.target.value)} placeholder="Línea libre (servicio, concepto)" className="w-56" />
                  <Input type="number" min="0.01" step="any" value={libreCant} onChange={(e) => setLibreCant(e.target.value)} className="w-20" title="Cantidad" />
                  <Input type="number" min="0" step="any" value={librePrecio} onChange={(e) => setLibrePrecio(e.target.value)} placeholder="Precio" className="w-28" />
                  <Button variant="outline" size="icon" onClick={agregarLibre} aria-label="Agregar línea libre"><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50">
                    <TableHead>Descripción</TableHead>
                    <TableHead className="w-24 text-right">Cant.</TableHead>
                    <TableHead className="w-32 text-right">Precio</TableHead>
                    <TableHead className="w-24 text-right">Desc. %</TableHead>
                    <TableHead className="w-32 text-right">Subtotal</TableHead>
                    {!soloLectura && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineas.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Aún no hay líneas.</TableCell></TableRow>
                  ) : (
                    totales.lineas.map((t, i) => {
                      const l = lineas[i]
                      return (
                        <TableRow key={l._key}>
                          <TableCell>
                            {l.producto_id == null && !soloLectura ? (
                              <Input value={l.descripcion} onChange={(e) => actualizarLinea(l._key, { descripcion: e.target.value })} className="h-8" />
                            ) : (
                              <span className="text-sm">{l.descripcion}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input type="number" min="0" step="any" value={l.cantidad} onChange={(e) => actualizarLinea(l._key, { cantidad: Number(e.target.value) })} className="h-8 text-right" disabled={soloLectura} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input type="number" min="0" step="any" value={l.precio_unitario} onChange={(e) => actualizarLinea(l._key, { precio_unitario: Number(e.target.value) })} className="h-8 text-right" disabled={soloLectura} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input type="number" min="0" max="100" step="any" value={l.descuento_linea} onChange={(e) => actualizarLinea(l._key, { descuento_linea: Number(e.target.value) })} className="h-8 text-right" disabled={soloLectura} />
                          </TableCell>
                          <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(t.subtotal)}</TableCell>
                          {!soloLectura && (
                            <TableCell>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => setLineas((prev) => prev.filter((x) => x._key !== l._key))} aria-label="Quitar">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="ml-auto w-full sm:w-72 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(totales.subtotal)}</span></div>
              {totales.descuentoMonto > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Descuento ({descuento}%)</span><span>- {formatCurrency(totales.descuentoMonto)}</span></div>
              )}
              {aplicaIsv && (
                <div className="flex justify-between"><span className="text-muted-foreground">ISV 15 %</span><span>{formatCurrency(totales.impuesto)}</span></div>
              )}
              <div className="flex justify-between border-t pt-1 font-semibold text-base"><span>Total</span><span>{formatCurrency(totales.total)}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

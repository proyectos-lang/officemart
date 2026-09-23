"use client"

import * as React from "react"
import { Loader2, Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useToast } from "@/hooks/use-toast"
import type { Cliente } from "@/lib/services/catalogos"
import type { Vendedor } from "@/lib/services/vendedores"
import {
  TIPOS_ACTIVIDAD,
  crearActividad,
  actualizarActividad,
  hondurasLocalAIso,
  isoAHondurasLocal,
  nombreCuenta,
  type ActividadCrm,
  type ActividadInput,
  type ContactoCrm,
  type OportunidadCrm,
  type TipoActividad,
} from "@/lib/services/crm"

export interface ActividadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Si viene, edita; si no, crea con `defaults`. */
  actividad?: ActividadCrm | null
  defaults?: Partial<ActividadInput>
  oportunidades: OportunidadCrm[]
  clientes: Cliente[]
  contactos: ContactoCrm[]
  vendedores: Vendedor[]
  onSaved: (a: ActividadCrm) => void
}

/** Diálogo compartido (Pipeline y Agenda) para programar/editar una actividad. */
export function ActividadDialog(props: ActividadDialogProps) {
  const { open, onOpenChange, actividad } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{actividad ? "Editar actividad" : "Nueva actividad"}</DialogTitle>
          <DialogDescription>Llamadas, visitas, reuniones, correos, tareas o notas de seguimiento.</DialogDescription>
        </DialogHeader>
        {open && <ActividadForm key={actividad?.id ?? "nueva"} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function ActividadForm({ actividad, defaults, oportunidades, clientes, contactos, vendedores, onSaved, onOpenChange }: ActividadDialogProps) {
  const { toast } = useToast()
  const [saving, setSaving] = React.useState(false)
  const [tipo, setTipo] = React.useState<TipoActividad>(actividad?.tipo ?? defaults?.tipo ?? "Llamada")
  const [asunto, setAsunto] = React.useState(actividad?.asunto ?? defaults?.asunto ?? "")
  const [fecha, setFecha] = React.useState(isoAHondurasLocal(actividad?.fecha ?? defaults?.fecha ?? null))
  const [oportunidadId, setOportunidadId] = React.useState<number | null>(actividad?.oportunidad_id ?? defaults?.oportunidad_id ?? null)
  const [clienteId, setClienteId] = React.useState<number | null>(actividad?.cliente_id ?? defaults?.cliente_id ?? null)
  const [contactoId, setContactoId] = React.useState<number | null>(actividad?.contacto_id ?? defaults?.contacto_id ?? null)
  const [vendedorId, setVendedorId] = React.useState<number | null>(actividad?.vendedor_id ?? defaults?.vendedor_id ?? null)
  const [descripcion, setDescripcion] = React.useState(actividad?.descripcion ?? defaults?.descripcion ?? "")
  const [opOpen, setOpOpen] = React.useState(false)
  const [cliOpen, setCliOpen] = React.useState(false)

  const opSel = oportunidades.find((o) => o.id === oportunidadId) ?? null
  const cliSel = clientes.find((c) => c.id === clienteId) ?? null
  const contactosVisibles = contactos.filter((c) => clienteId == null || c.cliente_id == null || c.cliente_id === clienteId)

  function elegirOportunidad(o: OportunidadCrm | null) {
    setOportunidadId(o?.id ?? null)
    if (o) {
      if (o.cliente_id != null) setClienteId(o.cliente_id)
      if (o.contacto_id != null) setContactoId(o.contacto_id)
      if (o.vendedor_id != null && vendedorId == null) setVendedorId(o.vendedor_id)
    }
    setOpOpen(false)
  }

  async function guardar() {
    if (!asunto.trim()) {
      toast({ title: "Escribe el asunto", variant: "destructive" })
      return
    }
    if (!fecha) {
      toast({ title: "Indica la fecha y hora", variant: "destructive" })
      return
    }
    setSaving(true)
    const input: ActividadInput = {
      tipo,
      asunto,
      fecha: hondurasLocalAIso(fecha),
      oportunidad_id: oportunidadId,
      cliente_id: clienteId,
      contacto_id: contactoId,
      vendedor_id: vendedorId,
      descripcion,
    }
    const res = actividad ? await actualizarActividad(actividad.id, input) : await crearActividad(input)
    setSaving(false)
    if (res.error || !res.data) {
      toast({ title: "No se pudo guardar", description: res.error ?? "", variant: "destructive" })
      return
    }
    toast({ title: actividad ? "Actividad actualizada" : "Actividad programada" })
    onSaved(res.data)
    onOpenChange(false)
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Tipo</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoActividad)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TIPOS_ACTIVIDAD.map((t) => <SelectItem key={t} value={t}>{t === "Reunion" ? "Reunión" : t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Fecha y hora</Label>
          <Input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Asunto</Label>
        <Input value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="Ej. Llamar para confirmar propuesta" autoFocus />
      </div>
      <div className="space-y-1">
        <Label>Oportunidad (opcional)</Label>
        <Popover open={opOpen} onOpenChange={setOpOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
              <span className="truncate">{opSel ? `${opSel.titulo} · ${nombreCuenta(opSel)}` : "Sin oportunidad"}</span>
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[360px]" align="start">
            <Command>
              <CommandInput placeholder="Buscar oportunidad…" />
              <CommandList>
                <CommandEmpty>Sin resultados.</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="__ninguna" onSelect={() => elegirOportunidad(null)}>
                    <Check className={`mr-2 h-4 w-4 ${oportunidadId == null ? "opacity-100" : "opacity-0"}`} /> Sin oportunidad
                  </CommandItem>
                  {oportunidades.map((o) => (
                    <CommandItem key={o.id} value={`${o.titulo} ${nombreCuenta(o)}`} onSelect={() => elegirOportunidad(o)}>
                      <Check className={`mr-2 h-4 w-4 ${o.id === oportunidadId ? "opacity-100" : "opacity-0"}`} />
                      <span className="truncate">{o.titulo} <span className="text-muted-foreground">· {nombreCuenta(o)}</span></span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Cliente</Label>
          <Popover open={cliOpen} onOpenChange={setCliOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                <span className="truncate">{cliSel ? cliSel.nombre : "Sin cliente"}</span>
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[320px]" align="start">
              <Command>
                <CommandInput placeholder="Buscar cliente…" />
                <CommandList>
                  <CommandEmpty>Sin resultados.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="__ninguno" onSelect={() => { setClienteId(null); setCliOpen(false) }}>
                      <Check className={`mr-2 h-4 w-4 ${clienteId == null ? "opacity-100" : "opacity-0"}`} /> Sin cliente
                    </CommandItem>
                    {clientes.map((c) => (
                      <CommandItem key={c.id} value={`${c.nombre} ${c.rtn || ""}`} onSelect={() => { setClienteId(c.id ?? null); setContactoId(null); setCliOpen(false) }}>
                        <Check className={`mr-2 h-4 w-4 ${c.id === clienteId ? "opacity-100" : "opacity-0"}`} /> {c.nombre}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-1">
          <Label>Contacto</Label>
          <Select value={contactoId != null ? String(contactoId) : "0"} onValueChange={(v) => setContactoId(v === "0" ? null : Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Sin contacto</SelectItem>
              {contactosVisibles.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}{c.cargo ? ` · ${c.cargo}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {vendedores.length > 0 && (
        <div className="space-y-1">
          <Label>Responsable (vendedor)</Label>
          <Select value={vendedorId != null ? String(vendedorId) : "0"} onValueChange={(v) => setVendedorId(v === "0" ? null : Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Sin asignar</SelectItem>
              {vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1">
        <Label>Detalle (opcional)</Label>
        <Textarea rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Guardar</Button>
      </DialogFooter>
    </div>
  )
}

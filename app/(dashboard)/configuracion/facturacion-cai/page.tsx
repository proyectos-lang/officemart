"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Receipt, Lock, MapPin } from "lucide-react"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { ConfigCaiForm } from "@/components/facturacion/config-cai-form"
import {
  getConfigsCai,
  saveConfigCai,
  nuevaConfigCai,
  tipoDocumentoLabel,
  TIPOS_DOCUMENTO_CAI,
  type ConfigCai,
} from "@/lib/services/facturacion-cai"
import { getPuntosFacturacion } from "@/lib/services/puntos-facturacion"

/**
 * Configuración CAI de la EMPRESA (punto 0). Cuando la empresa tiene puntos de
 * facturación (script officemart-004), cada punto lleva su propio CAI y se
 * configura en Configuración → Puntos de Facturación; aquí se avisa.
 */
export default function FacturacionCaiPage() {
  const { user, hasModulo } = useAuth()
  const { toast } = useToast()
  const activa = user?.flags?.facturacion_cai ?? false

  const [loading, setLoading] = useState(true)
  const [savingTipo, setSavingTipo] = useState<string | null>(null)
  // Config por tipo de documento (mapa codigo -> ConfigCai).
  const [configs, setConfigs] = useState<Record<string, ConfigCai>>({})
  const [hayPuntos, setHayPuntos] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [{ data }, puntosRes] = await Promise.all([getConfigsCai(0), getPuntosFacturacion({ soloActivos: true })])
      if (!vivo) return
      const mapa: Record<string, ConfigCai> = {}
      for (const t of TIPOS_DOCUMENTO_CAI) mapa[t.codigo] = nuevaConfigCai(t.codigo)
      for (const c of data) mapa[c.tipo_documento] = c
      setConfigs(mapa)
      setHayPuntos((puntosRes.data || []).length > 0)
      setLoading(false)
    })()
    return () => {
      vivo = false
    }
  }, [])

  function actualizar(tipo: string, cambios: Partial<ConfigCai>) {
    setConfigs((prev) => ({ ...prev, [tipo]: { ...prev[tipo], ...cambios } }))
  }

  async function guardar(tipo: string) {
    const cfg = configs[tipo]
    if (!cfg) return
    setSavingTipo(tipo)
    const { data, error } = await saveConfigCai(cfg, 0)
    setSavingTipo(null)
    if (error || !data) {
      toast({ title: "No se pudo guardar", description: error ?? "Intenta de nuevo.", variant: "destructive" })
      return
    }
    setConfigs((prev) => ({ ...prev, [tipo]: data }))
    toast({ title: "Configuración guardada", description: `${tipoDocumentoLabel(tipo)}: datos CAI actualizados.` })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
          <Receipt className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Facturación CAI</h1>
          <p className="text-sm text-muted-foreground">
            Configura los datos fiscales para emitir facturas oficiales del SAR (Honduras).
          </p>
        </div>
      </div>

      {!activa ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Lock className="h-8 w-8 text-stone-400" />
            <p className="max-w-md text-sm text-muted-foreground">
              La función <strong>Facturación CAI</strong> no está activada para tu empresa. Solicita al
              administrador de la plataforma que la habilite para poder emitir comprobantes fiscales.
            </p>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-2 h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : (
        <>
          {hayPuntos && (
            <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Tu empresa tiene <strong>puntos de facturación</strong>: cada punto emite con su propio CAI, que se
                configura en{" "}
                {hasModulo("Puntos de Facturación") ? (
                  <Link href="/configuracion/puntos-facturacion" className="underline">
                    Configuración → Puntos de Facturación
                  </Link>
                ) : (
                  <strong>Configuración → Puntos de Facturación</strong>
                )}
                . La autorización de esta pantalla solo se usa en ventas emitidas <em>sin</em> punto.
              </span>
            </div>
          )}
          <Tabs defaultValue="01">
            <TabsList>
              {TIPOS_DOCUMENTO_CAI.map((t) => (
                <TabsTrigger key={t.codigo} value={t.codigo}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {TIPOS_DOCUMENTO_CAI.map((t) => (
              <TabsContent key={t.codigo} value={t.codigo}>
                <ConfigCaiForm
                  cfg={configs[t.codigo]}
                  onChange={(c) => actualizar(t.codigo, c)}
                  onSave={() => guardar(t.codigo)}
                  saving={savingTipo === t.codigo}
                />
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}
    </div>
  )
}

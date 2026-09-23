"use client"

import { useEffect, useState } from "react"
import { isSupabaseConfigured } from "@/lib/supabase/client"
import { useAuth } from "@/lib/contexts/auth-context"
import { contarPorVencer } from "@/lib/services/cotizaciones"

/**
 * Cotizaciones enviadas/aprobadas que vencen en los próximos 3 días (badge del
 * sidebar, módulo Cotizaciones). Se refresca cada 5 min y al volver el foco.
 * Si la tabla no existe (officemart-006 sin aplicar) devuelve 0 en silencio.
 */
export function useCotizacionesPorVencer(): number {
  const { user, hasModulo } = useAuth()
  const [porVencer, setPorVencer] = useState(0)

  useEffect(() => {
    if (!user || !isSupabaseConfigured() || !hasModulo("Cotizaciones")) return
    let activo = true

    async function contar() {
      const n = await contarPorVencer(3)
      if (activo) setPorVencer(n)
    }

    contar()
    const intervalo = setInterval(contar, 300_000)
    const onFocus = () => contar()
    window.addEventListener("focus", onFocus)
    return () => {
      activo = false
      clearInterval(intervalo)
      window.removeEventListener("focus", onFocus)
    }
  }, [user, hasModulo])

  return porVencer
}

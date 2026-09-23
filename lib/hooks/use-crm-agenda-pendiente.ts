"use client"

import { useEffect, useState } from "react"
import { isSupabaseConfigured } from "@/lib/supabase/client"
import { useAuth } from "@/lib/contexts/auth-context"
import { contarAgendaPendiente } from "@/lib/services/crm"

/**
 * Actividades CRM pendientes vencidas o de hoy (badge del sidebar, módulo
 * CRM Agenda). Se refresca cada 5 min y al volver el foco. Si la tabla no
 * existe (officemart-016 sin aplicar) devuelve 0 en silencio.
 */
export function useCrmAgendaPendiente(): number {
  const { user, hasModulo } = useAuth()
  const [pendientes, setPendientes] = useState(0)

  useEffect(() => {
    if (!user || !isSupabaseConfigured() || !hasModulo("CRM Agenda")) return
    let activo = true

    async function contar() {
      const n = await contarAgendaPendiente()
      if (activo) setPendientes(n)
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

  return pendientes
}

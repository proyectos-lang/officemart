"use client"

import { useEffect, useState } from "react"
import { isSupabaseConfigured } from "@/lib/supabase/client"
import { useAuth } from "@/lib/contexts/auth-context"
import { getBackorders } from "@/lib/services/compras-recepciones"

/**
 * Órdenes de compra con backorder (recibidas parcialmente y con pendiente),
 * para el badge del sidebar (módulo Backorder). Se refresca cada 5 min y al
 * volver el foco. Si el script officemart-008 no está aplicado, devuelve 0.
 */
export function useBackordersPendientes(): number {
  const { user, hasModulo } = useAuth()
  const [n, setN] = useState(0)

  useEffect(() => {
    if (!user || !isSupabaseConfigured() || !hasModulo("Backorder")) return
    let activo = true
    async function contar() {
      const { data } = await getBackorders()
      if (activo) setN(data.length)
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

  return n
}

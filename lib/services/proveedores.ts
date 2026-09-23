"use client"

/**
 * Servicio minimo para la tabla `proveedores` que ya existe en la BD del
 * usuario y a la que apunta `gastos.proveedor_id` (FK). Solo necesitamos
 * listar y crear proveedores; el resto de operaciones son raras desde el
 * UI de Gastos.
 *
 * Asumimos que la tabla tiene al menos:
 *   id (bigint), nombre (text), razon_social_id (uuid/bigint), created_at
 *
 * Si la tabla no existe (un tenant sin proveedores migrados), getProveedores
 * regresa lista vacia y la UI degradara a un input de texto libre opcional
 * via `notas` del gasto.
 */

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import {
  getTenantStamp,
  isValidStamp,
  SESION_INVALIDA_ERROR,
} from "@/lib/services/tenant-stamp"
import type { Proveedor } from "@/lib/services/catalogos"

// Una sola definicion de Proveedor para toda la app (la de catalogos.ts).
export type { Proveedor }

/** Indicador para que la UI sepa cuando la tabla no esta disponible. */
export const PROVEEDORES_FEATURE_PENDING = "feature_pending"

function isMissingTable(err: { message?: string } | null): boolean {
  if (!err?.message) return false
  return /relation .*proveedores.* does not exist|could not find.*proveedores/i.test(
    err.message
  )
}

export async function getProveedores(): Promise<{
  data: Proveedor[]
  error: string | null
}> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem("proveedores")
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  // Pedimos solo columnas garantizadas (id, nombre). Si la tabla tiene
  // mas columnas, el cliente las ignora; si no las tiene, no fallamos.
  const { data, error } = await supabase
    .from("proveedores")
    .select("id, nombre")
    .order("nombre", { ascending: true })

  if (error) {
    if (isMissingTable(error)) {
      console.log("[proveedores] tabla no existe, devolviendo vacio")
      return { data: [], error: PROVEEDORES_FEATURE_PENDING }
    }
    return { data: [], error: error.message }
  }
  return { data: (data || []) as Proveedor[], error: null }
}

/**
 * Crea un proveedor minimo (solo nombre + tenant). Pensado para el
 * "quick-create" desde el modal de Nuevo Gasto.
 */
export async function createProveedor(
  nombre: string
): Promise<{ data: Proveedor | null; error: string | null }> {
  const trimmed = nombre.trim()
  if (!trimmed) {
    return { data: null, error: "Ingrese un nombre para el proveedor" }
  }

  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem("proveedores")
    const list: Proveedor[] = saved ? JSON.parse(saved) : []
    const nuevo: Proveedor = {
      id: Date.now(),
      nombre: trimmed,
      created_at: new Date().toISOString(),
    }
    list.push(nuevo)
    localStorage.setItem("proveedores", JSON.stringify(list))
    return { data: nuevo, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { data: null, error: SESION_INVALIDA_ERROR }
  }

  const { data, error } = await supabase
    .from("proveedores")
    .insert({ nombre: trimmed, ...stamp })
    .select("id, nombre")
    .single()

  if (error) {
    if (isMissingTable(error)) {
      return { data: null, error: PROVEEDORES_FEATURE_PENDING }
    }
    return { data: null, error: error.message }
  }
  return { data: data as Proveedor, error: null }
}

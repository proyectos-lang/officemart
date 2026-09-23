"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/contexts/auth-context"
import { Home, ChevronRight, LayoutDashboard, ShoppingCart, FileText, ClipboardList, CreditCard, Settings, GraduationCap, Sparkles, Factory } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarFooter,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { MODULOS, CATEGORIAS_ORDEN, type Categoria, type ModuloGranular } from "@/lib/constants/modulos"
import { usePedidosPendientes } from "@/lib/hooks/use-pedidos-pendientes"
import { useCotizacionesPorVencer } from "@/lib/hooks/use-cotizaciones-por-vencer"
import { useActualizaciones } from "@/lib/hooks/use-actualizaciones"

// Iconos por categoria (el contenedor del collapsible)
const CATEGORIA_ICON: Record<Categoria, React.ComponentType<{ className?: string }>> = {
  Dashboard: LayoutDashboard,
  Ventas: ShoppingCart,
  Compras: FileText,
  Inventario: ClipboardList,
  Produccion: Factory,
  Finanzas: CreditCard,
  Configuracion: Settings,
}

function getInitials(name: string): string {
  if (!name) return "U"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function ERPSidebar() {
  const pathname = usePathname()
  const { user, hasModulo } = useAuth()
  const pedidosPendientes = usePedidosPendientes()
  const cotizacionesPorVencer = useCotizacionesPorVencer()
  const { hayNueva: hayActualizacion } = useActualizaciones()

  // Agrupa los modulos granulares por categoria, filtrando por permiso
  // en CADA HOJA (no en el contenedor). Si una categoria queda vacia,
  // no se renderiza.
  const grupos = React.useMemo(() => {
    const out: Array<{ categoria: Categoria; modulos: ModuloGranular[] }> = []
    for (const categoria of CATEGORIAS_ORDEN) {
      const modulos = MODULOS.filter(
        (m) => m.categoria === categoria && hasModulo(m.nombre)
      )
      if (modulos.length > 0) out.push({ categoria, modulos })
    }
    return out
  }, [hasModulo])

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-5">
        <Link href="/" className="flex items-center justify-center group">
          {user?.logo_url ? (
            <img
              src={user.logo_url || "/placeholder.svg"}
              alt={user.razon_social_nombre || "EasyCount"}
              className="h-12 w-auto max-w-[160px] object-contain transition-opacity duration-300 group-hover:opacity-80"
            />
          ) : (
            <img
              src="/easycount-logo.jpeg"
              alt="EasyCount"
              className="h-12 w-auto max-w-[160px] object-contain transition-opacity duration-300 group-hover:opacity-80"
            />
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-stone-500 uppercase text-xs tracking-wider font-medium">
            Menu Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Inicio: siempre visible */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Inicio" isActive={pathname === "/"}>
                  <Link href="/">
                    <Home className="h-4 w-4" />
                    <span>Inicio</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {grupos.map(({ categoria, modulos }) => {
                const Icon = CATEGORIA_ICON[categoria]
                const isActive = modulos.some((m) => pathname === m.href || pathname.startsWith(m.href + "/"))

                // Si la categoria tiene un solo modulo, lo mostramos plano
                // (sin collapsible) para simplificar la navegacion.
                if (modulos.length === 1) {
                  const m = modulos[0]
                  return (
                    <SidebarMenuItem key={m.nombre}>
                      <SidebarMenuButton
                        asChild
                        tooltip={m.nombre}
                        isActive={pathname === m.href || pathname.startsWith(m.href + "/")}
                      >
                        <Link href={m.href}>
                          <m.icon className="h-4 w-4" />
                          <span>{m.nombre}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                }

                return (
                  <Collapsible key={categoria} asChild defaultOpen={isActive}>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={categoria} isActive={isActive}>
                          <Icon className="h-4 w-4" />
                          <span>{categoria}</span>
                          {categoria === "Ventas" && pedidosPendientes > 0 && (
                            <span className="ml-auto rounded-full bg-amber-500 text-white text-[10px] font-semibold px-1.5 py-0.5 leading-none">
                              {pedidosPendientes}
                            </span>
                          )}
                          <ChevronRight className={`h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 ${categoria === "Ventas" && pedidosPendientes > 0 ? "" : "ml-auto"}`} />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {modulos.map((m) => (
                            <SidebarMenuSubItem key={m.nombre}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={pathname === m.href || pathname.startsWith(m.href + "/")}
                              >
                                <Link href={m.href}>
                                  <m.icon className="h-3.5 w-3.5" />
                                  <span>{m.nombre}</span>
                                  {m.nombre === "Catalogo" && pedidosPendientes > 0 && (
                                    <span className="ml-auto rounded-full bg-amber-500 text-white text-[10px] font-semibold px-1.5 py-0.5 leading-none">
                                      {pedidosPendientes}
                                    </span>
                                  )}
                                  {m.nombre === "Cotizaciones" && cotizacionesPorVencer > 0 && (
                                    <span
                                      className="ml-auto rounded-full bg-amber-500 text-white text-[10px] font-semibold px-1.5 py-0.5 leading-none"
                                      title="Cotizaciones por vencer (3 días)"
                                    >
                                      {cotizacionesPorVencer}
                                    </span>
                                  )}
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Seccion independiente: Centro de Aprendizaje. Visible para TODOS
            los usuarios autenticados (no depende de permisos de modulo). */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-stone-500 uppercase text-xs tracking-wider font-medium">
            Ayuda
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Aprendizaje"
                  isActive={pathname === "/aprendizaje" || pathname.startsWith("/aprendizaje/")}
                >
                  <Link href="/aprendizaje">
                    <GraduationCap className="h-4 w-4" />
                    <span>Aprendizaje</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Actualizaciones"
                  isActive={pathname === "/actualizaciones" || pathname.startsWith("/actualizaciones/")}
                >
                  <Link href="/actualizaciones">
                    <Sparkles className="h-4 w-4" />
                    <span>Actualizaciones</span>
                    {hayActualizacion && (
                      <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500" aria-label="Nueva actualización" />
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-sidebar-accent transition-all duration-300">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-white text-sm font-medium shadow-sm"
            style={{ backgroundColor: "#abcde0" }}
          >
            {getInitials(user?.nombre || "Usuario")}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-stone-700 truncate">{user?.nombre || "Usuario"}</span>
            <span className="text-xs text-stone-500 truncate">{user?.email || "-"}</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

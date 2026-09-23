import {
  getResumenEmpresas,
  getDbStats,
  getSupabaseProjectStatus,
} from "@/lib/services/plataforma"
import { FlagToggle } from "./flag-toggle"
import { LogoutButton } from "./logout-button"
import { CrearEmpresaDialog } from "./crear-empresa"
import { GestionUsuariosDialog } from "./gestion-usuarios"
import { GestionModulosDialog } from "./gestion-modulos"

export const dynamic = "force-dynamic"

// ---- helpers de formato (server-side) ----
function fmtNum(n: number): string {
  return (n || 0).toLocaleString("es-HN")
}
function fmtBytes(b: number): string {
  if (!b) return "0 B"
  const u = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1)
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}
function haceCuanto(s: string | null): string {
  if (!s) return "nunca"
  const ms = Date.now() - new Date(s).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return "hace instantes"
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 30) return `hace ${d} d`
  const mo = Math.floor(d / 30)
  return `hace ${mo} mes${mo > 1 ? "es" : ""}`
}
function activaReciente(s: string | null): boolean {
  if (!s) return false
  return Date.now() - new Date(s).getTime() < 30 * 24 * 60 * 60 * 1000 // < 30 dias
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-stone-400">{sub}</p>}
    </div>
  )
}

export default async function PlataformaPage() {
  const [empRes, dbRes, proj] = await Promise.all([
    getResumenEmpresas(),
    getDbStats(),
    getSupabaseProjectStatus(),
  ])

  const empresas = empRes.data
  const db = dbRes.data
  const err = empRes.error || dbRes.error

  const totUsuarios = empresas.reduce((a, e) => a + e.usuarios, 0)
  const activas = empresas.filter((e) => activaReciente(e.ultima_conexion)).length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Gestión de la plataforma</h1>
          <p className="mt-1 text-sm text-stone-500">
            Todas las empresas del sistema, sus métricas de uso y el estado de la base de datos.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CrearEmpresaDialog />
          <LogoutButton />
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err} {" · "}
          <span className="text-red-500">
            ¿Aplicaste <code>scripts/037-plataforma-admin.sql</code> y está configurado
            <code> SUPABASE_SERVICE_ROLE_KEY</code>?
          </span>
        </div>
      )}

      {/* KPIs globales (administracion: sin datos de ventas ni inventario) */}
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Empresas" value={fmtNum(empresas.length)} sub={`${activas} activas (30 d)`} />
        <Kpi label="Usuarios" value={fmtNum(totUsuarios)} />
        <Kpi label="Tamaño BD" value={db ? fmtBytes(db.db_bytes) : "—"} />
      </div>

      {/* Estado de la base de datos */}
      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Estado de la base de datos</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 px-4 py-4 md:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-stone-500">Tamaño</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{db ? fmtBytes(db.db_bytes) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-stone-500">Conexiones</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">
              {db ? `${db.conexiones} / ${db.conexiones_max}` : "—"}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-stone-500">Estado del proyecto</p>
            {proj.configured ? (
              proj.error ? (
                <p className="mt-0.5 text-lg font-semibold text-amber-600">{proj.error}</p>
              ) : (
                <p className="mt-0.5 text-lg font-semibold text-emerald-700">
                  {proj.status || "OK"}
                  {proj.region ? <span className="ml-1 text-xs font-normal text-stone-400">· {proj.region}</span> : null}
                </p>
              )
            ) : (
              <p className="mt-0.5 text-xs text-stone-400">
                Agrega <code>SUPABASE_ACCESS_TOKEN</code> para ver el estado del proyecto (el
                project ref se toma de la URL).
              </p>
            )}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-stone-500">Totales</p>
            <p className="mt-0.5 text-sm text-stone-600">
              {db ? `${fmtNum(db.empresas)} empresas · ${fmtNum(db.usuarios)} usuarios` : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Tabla de empresas */}
      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Empresas ({empresas.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">Empresa</th>
                <th className="px-4 py-2 font-medium">RTN</th>
                <th className="px-4 py-2 text-right font-medium">Usuarios</th>
                <th className="px-4 py-2 font-medium">Última conexión</th>
                <th className="px-4 py-2 font-medium">Gestión</th>
                <th className="px-4 py-2 font-medium" title="Mostrar el ISV (15%) en Nueva Venta para esta empresa">
                  ISV en ventas
                </th>
                <th className="px-4 py-2 font-medium" title="Imprimir el codigo del producto bajo su nombre en la tirilla termica">
                  Codigo en tirilla
                </th>
                <th className="px-4 py-2 font-medium" title="Activar el lector de codigo de barras en Nueva Venta (escanear = ubicar/agregar)">
                  Lector codigo
                </th>
                <th className="px-4 py-2 font-medium" title="Productos por talla: check 'tiene tallas' al crear + agrupamiento de tallas en Productos e Inventario">
                  Productos por talla
                </th>
                <th className="px-4 py-2 font-medium" title="Venta rápida: en Nueva Venta, agregar una línea con descripción y precio a mano, sin afectar inventario">
                  Venta rápida
                </th>
                <th className="px-4 py-2 font-medium" title="Facturación CAI: habilita el módulo 'Facturación CAI' en Configuración para emitir facturas oficiales del SAR (Honduras)">
                  Factura CAI
                </th>
                <th className="px-4 py-2 font-medium" title="Bloquea la edición del precio de venta por línea y el descuento en Nueva Venta para los usuarios NO admin (el admin sí puede)">
                  Bloquear precio/desc.
                </th>
                <th className="px-4 py-2 font-medium" title="Oculta el saldo y los montos de Caja Chica a los usuarios NO admin (cierre a ciegas); el admin ve todo">
                  Ocultar saldo caja
                </th>
                <th className="px-4 py-2 font-medium" title="Exige elegir un vendedor en Nueva Venta (requiere el módulo 'Vendedores y Zonas' habilitado)">
                  Vendedor obligatorio
                </th>
                <th className="px-4 py-2 font-medium" title="Permite BORRAR ventas (copia en 'Eliminadas') además de anularlas. Con CAI conviene dejarlo apagado: solo anular">
                  Permitir borrar ventas
                </th>
              </tr>
            </thead>
            <tbody>
              {empresas.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-stone-400">
                    Sin empresas para mostrar.
                  </td>
                </tr>
              ) : (
                empresas.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-stone-50/60">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${activaReciente(e.ultima_conexion) ? "bg-emerald-500" : "bg-stone-300"}`}
                          title={activaReciente(e.ultima_conexion) ? "Activa" : "Inactiva"}
                        />
                        <div>
                          <p className="font-medium text-stone-800">{e.nombre}</p>
                          {e.comercial && e.comercial !== e.nombre && (
                            <p className="text-[11px] text-stone-400">{e.comercial}</p>
                          )}
                        </div>
                        <span className="ml-1 text-[10px] text-stone-300">#{e.id}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-stone-500">{e.rtn || "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {e.usuarios}
                      <span className="text-stone-400"> ({e.usuarios_activos})</span>
                    </td>
                    <td className="px-4 py-2 text-stone-500" title={e.ultima_conexion || ""}>
                      {haceCuanto(e.ultima_conexion)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <GestionUsuariosDialog razonSocialId={e.id} empresaNombre={e.nombre} />
                        <GestionModulosDialog razonSocialId={e.id} empresaNombre={e.nombre} />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <FlagToggle
                        razonSocialId={e.id}
                        flag="ventas_mostrar_isv"
                        initial={e.flags.ventas_mostrar_isv}
                        onLabel="Muestra"
                        offLabel="Oculto"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <FlagToggle
                        razonSocialId={e.id}
                        flag="tirilla_mostrar_codigo"
                        initial={e.flags.tirilla_mostrar_codigo}
                        onLabel="Sí"
                        offLabel="No"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <FlagToggle
                        razonSocialId={e.id}
                        flag="ventas_lector_codigo_barras"
                        initial={e.flags.ventas_lector_codigo_barras}
                        onLabel="Activo"
                        offLabel="Inactivo"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <FlagToggle
                        razonSocialId={e.id}
                        flag="productos_por_talla"
                        initial={e.flags.productos_por_talla}
                        onLabel="Activo"
                        offLabel="Inactivo"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <FlagToggle
                        razonSocialId={e.id}
                        flag="venta_rapida"
                        initial={e.flags.venta_rapida}
                        onLabel="Activo"
                        offLabel="Inactivo"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <FlagToggle
                        razonSocialId={e.id}
                        flag="facturacion_cai"
                        initial={e.flags.facturacion_cai}
                        onLabel="Activo"
                        offLabel="Inactivo"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <FlagToggle
                        razonSocialId={e.id}
                        flag="ventas_bloquear_precio_descuento"
                        initial={e.flags.ventas_bloquear_precio_descuento}
                        onLabel="Bloqueado"
                        offLabel="Libre"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <FlagToggle
                        razonSocialId={e.id}
                        flag="caja_ocultar_saldo"
                        initial={e.flags.caja_ocultar_saldo}
                        onLabel="Oculto"
                        offLabel="Visible"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <FlagToggle
                        razonSocialId={e.id}
                        flag="ventas_vendedor_obligatorio"
                        initial={e.flags.ventas_vendedor_obligatorio}
                        onLabel="Obligatorio"
                        offLabel="Opcional"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <FlagToggle
                        razonSocialId={e.id}
                        flag="ventas_permitir_eliminar"
                        initial={e.flags.ventas_permitir_eliminar}
                        onLabel="Permitido"
                        offLabel="Solo anular"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-stone-400">
        Ingreso del mes = suma de <code>total_venta</code> del mes en curso. Inventario = Σ (stock × costo
        promedio). Última conexión = último <code>last_sign_in_at</code> de los usuarios de la empresa.
      </p>
    </div>
  )
}

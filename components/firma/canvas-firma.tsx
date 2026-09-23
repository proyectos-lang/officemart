"use client"

import * as React from "react"
import { Eraser } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Pad de firma manuscrita (pointer events: ratón, dedo o lápiz).
 * Emite un data URL PNG con fondo transparente, o null si está vacío.
 */
export function CanvasFirma({ onChange, alto = 160 }: { onChange: (dataUrl: string | null) => void; alto?: number }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const dibujando = React.useRef(false)
  const ultimo = React.useRef<{ x: number; y: number } | null>(null)
  const [vacio, setVacio] = React.useState(true)

  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ajustar = () => {
      const dpr = window.devicePixelRatio || 1
      const ancho = canvas.clientWidth
      const datos = canvas.toDataURL()
      canvas.width = Math.round(ancho * dpr)
      canvas.height = Math.round(alto * dpr)
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctx.lineWidth = 2.2
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.strokeStyle = "#1c1917"
      if (!vacio) {
        const img = new Image()
        img.onload = () => ctx.drawImage(img, 0, 0, ancho, alto)
        img.src = datos
      }
    }
    ajustar()
    window.addEventListener("resize", ajustar)
    return () => window.removeEventListener("resize", ajustar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alto])

  function punto(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function inicio(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dibujando.current = true
    ultimo.current = punto(e)
  }

  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return
    e.preventDefault()
    const ctx = e.currentTarget.getContext("2d")
    const p = punto(e)
    if (ctx && ultimo.current) {
      ctx.beginPath()
      ctx.moveTo(ultimo.current.x, ultimo.current.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
    ultimo.current = p
    if (vacio) setVacio(false)
  }

  function fin(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return
    dibujando.current = false
    ultimo.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ya liberado */
    }
    onChange(e.currentTarget.toDataURL("image/png"))
  }

  function limpiar() {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    setVacio(true)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg border-2 border-dashed border-stone-300 bg-white">
        <canvas
          ref={ref}
          className="w-full touch-none rounded-lg"
          style={{ height: alto }}
          onPointerDown={inicio}
          onPointerMove={mover}
          onPointerUp={fin}
          onPointerCancel={fin}
          onPointerLeave={fin}
        />
        {vacio && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-stone-400">Firma aquí con el dedo, lápiz o ratón</p>}
        <div className="pointer-events-none absolute left-4 right-4 bottom-8 border-b border-stone-300" />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={limpiar} disabled={vacio} className="gap-1"><Eraser className="h-4 w-4" /> Limpiar</Button>
      </div>
    </div>
  )
}

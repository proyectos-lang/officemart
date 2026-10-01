/**
 * Calendario laboral de planta (convención HN-as-UTC: los componentes UTC de
 * la fecha son la hora de Honduras). Lunes a viernes 8:00–17:00, sábado
 * 8:00–12:00, domingo cerrado. Funciones puras.
 */

const H = 3_600_000

export function jornada(d: Date): [number, number] | null {
  const dia = d.getUTCDay()
  if (dia === 0) return null
  return dia === 6 ? [8, 12] : [8, 17]
}

function inicioDia(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** Primer instante laborable igual o posterior a `t`. */
export function abierto(t: Date): Date {
  let d = new Date(t)
  for (let i = 0; i < 21; i++) {
    const j = jornada(d)
    if (j) {
      const ini = new Date(inicioDia(d).getTime() + j[0] * H)
      const fin = new Date(inicioDia(d).getTime() + j[1] * H)
      if (d < ini) return ini
      if (d < fin) return d
    }
    d = new Date(inicioDia(d).getTime() + 24 * H)
  }
  return d
}

/** Suma `horas` de trabajo a partir de `t`, saltando noches y domingos. */
export function sumarHorasLaborales(t: Date, horas: number): Date {
  let actual = abierto(t)
  let resto = Math.max(0, horas) * H
  if (resto === 0) return actual
  for (let guard = 0; guard < 10_000 && resto > 0; guard++) {
    const j = jornada(actual)!
    const fin = new Date(inicioDia(actual).getTime() + j[1] * H)
    const disponible = fin.getTime() - actual.getTime()
    if (resto <= disponible) return new Date(actual.getTime() + resto)
    resto -= disponible
    actual = abierto(new Date(fin.getTime() + 1))
  }
  return actual
}

/** Horas laborales entre dos instantes (0 si `hasta` <= `desde`). */
export function horasLaboralesEntre(desde: Date, hasta: Date): number {
  if (hasta <= desde) return 0
  let total = 0
  let actual = abierto(desde)
  for (let guard = 0; guard < 10_000 && actual < hasta; guard++) {
    const j = jornada(actual)!
    const fin = new Date(inicioDia(actual).getTime() + j[1] * H)
    const tope = fin < hasta ? fin : hasta
    total += (tope.getTime() - actual.getTime()) / H
    if (fin >= hasta) break
    actual = abierto(new Date(fin.getTime() + 1))
  }
  return Math.round(total * 100) / 100
}

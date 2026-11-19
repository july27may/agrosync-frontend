const DAY_MS = 86_400_000

function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

export function age(birth: string | null, today: string): string {
  const start = birth ? calendarDate(birth) : null
  const end = calendarDate(today)
  if (!start || !end || start > end) return 'Edad desconocida'

  // UTC represents civil dates selected in local time, without daylight-saving offsets.
  function anniversary(months: number): Date {
    const date = new Date(start!.getTime())
    const day = date.getUTCDate()
    date.setUTCMonth(date.getUTCMonth() + months + 1, 0)
    date.setUTCDate(Math.min(day, date.getUTCDate()))
    return date
  }

  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12
    + end.getUTCMonth() - start.getUTCMonth()
  if (anniversary(months) > end) months--
  const days = (end.getTime() - anniversary(months).getTime()) / DAY_MS
  const years = Math.floor(months / 12)
  const remainder = months % 12
  const units = [
    years ? `${years} ${years === 1 ? 'año' : 'años'}` : '',
    remainder ? `${remainder} ${remainder === 1 ? 'mes' : 'meses'}` : '',
    days ? `${days} ${days === 1 ? 'día' : 'días'}` : '',
  ].filter(Boolean)
  return 'Edad: ' + (units.length ? new Intl.ListFormat('es').format(units) : '0 días')
}

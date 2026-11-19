const integer = new Intl.NumberFormat('es-CO')
export function money(cents: bigint): string {
  return `$ ${integer.format(cents / 100n)},${String(cents % 100n).padStart(2, '0')}`
}

export function kg(grams: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(grams / 1000)
}

export function localDate(): string {
  const date = new Date()
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(part => String(part).padStart(2, '0')).join('-')
}

export function labelDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

import type { WeeklyHarvest } from './weeklyHarvests'

export function weekRange(date: string) {
  const monday = new Date(`${date}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  const start = monday.toISOString().slice(0, 10)
  const end = sunday.toISOString().slice(0, 10)
  return { start, end }
}

export function weeklySettlement(records: WeeklyHarvest[], date: string) {
  const { start, end } = weekRange(date)
  const groups = new Map<string, { name: string; count: number; grams: number; amount: bigint }>()
  for (const record of records) {
    if (record.fecha < start || record.fecha > end) continue
    const key = record.recolector.id
    const row = groups.get(key) ?? { name: record.recolector.nombre, count: 0, grams: 0, amount: 0n }
    row.count++
    row.grams += record.pesoGramos
    row.amount += BigInt(record.pesoGramos) * BigInt(record.tarifaCentavos)
    groups.set(key, row)
  }
  const rows = [...groups.entries()].map(([id, row]) => ({
    id, ...row, cents: (row.amount + 500n) / 1000n,
  })).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return { start, end, rows, total: rows.reduce((sum, row) => sum + row.cents, 0n) }
}

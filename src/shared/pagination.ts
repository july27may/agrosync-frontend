import { request } from "./api"

interface Page<T> {
  items: T[]
  page: number
  totalPages: number | null
}

export async function downloadPages<T>(path: string, filters: Record<string, string> = {}): Promise<T[]> {
  const rows: T[] = []
  const size = 100
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ ...filters, page: String(page), size: String(size) })
    const response = await request(`${path}?${query}`)
    if (!response.ok) {
      throw new Error(`No se pudo descargar el catálogo de ${path} (HTTP ${response.status}).`)
    }
    const result: Page<T> = await response.json()
    if (!Array.isArray(result.items) || result.page !== page) {
      throw new Error(`El catálogo de ${path} llegó incompleto.`)
    }
    rows.push(...result.items)
    const hasMore = result.totalPages === null ? result.items.length === size : page < result.totalPages
    if (!hasMore) return rows
  }
}

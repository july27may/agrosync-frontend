import type { CatalogEntry } from '../catalogos/catalogs'
import { committed, openDatabase, result, STORES } from '../../shared/storage'

export const COFFEE = { cereza: 'Cereza', pergamino: 'Pergamino' } as const
export type CoffeeState = keyof typeof COFFEE

export interface Harvest {
  id: string
  owner: string
  operationId: string
  finca: CatalogEntry
  lote: CatalogEntry
  recolector: CatalogEntry
  fecha: string
  pesoGramos: number
  tarifaCentavos: number
  estadoCafe: CoffeeState
  createdAt: string
  crmId?: string
  syncedAt?: string
}

export function positiveUnits(input: string, decimals: number): number | null {
  const pattern = new RegExp(`^\\d{1,${14 - decimals}}(?:[.,]\\d{1,${decimals}})?$`)
  if (!pattern.test(input.trim())) return null
  const [whole, fraction = ''] = input.trim().split(/[.,]/)
  const value = Number(whole + fraction.padEnd(decimals, '0'))
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export async function listHarvests(owner: string): Promise<Harvest[]> {
  const db = await openDatabase()
  const rows: Harvest[] = await result(db.transaction(STORES.harvests).objectStore(STORES.harvests).getAll())
  return rows.filter(record => record.owner === owner).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.createdAt.localeCompare(a.createdAt))
}

export async function saveHarvest(draft: Omit<Harvest, 'id' | 'operationId' | 'createdAt'>): Promise<Harvest> {
  const db = await openDatabase()
  const record = {
    ...draft, id: crypto.randomUUID(), operationId: crypto.randomUUID(), createdAt: new Date().toISOString(),
  }
  const tx = db.transaction([STORES.harvests, STORES.operations], 'readwrite')
  const done = committed(tx)
  try {
    tx.objectStore(STORES.harvests).add(record)
    tx.objectStore(STORES.operations).add({
      operationId: record.operationId, owner: record.owner, recordId: record.id, entity: 'recoleccion',
      type: 'create', state: 'pending', payload: record, createdAt: record.createdAt,
    })
  } catch (error) {
    tx.abort()
    await done.catch(() => undefined)
    throw error
  }
  await done
  return record
}

import { request } from '../../shared/api'
import { committed, openDatabase, result, STORES } from '../../shared/storage'
import type { Harvest } from '../recolecciones/harvests'
import { discardGrant } from '../auth/auth'

export type WeeklyHarvest = Pick<Harvest, 'id' | 'crmId' | 'finca' | 'lote' | 'recolector'
  | 'fecha' | 'pesoGramos' | 'tarifaCentavos' | 'estadoCafe'>

export interface Snapshot {
  items: WeeklyHarvest[]
  fetchedAt: number
}

export function weeklyKey(owner: string, farm: string, monday: string) {
  return `cafe:semana:${owner}:${farm}:${monday}`
}

export async function readWeekly(key: string): Promise<Snapshot | undefined> {
  const db = await openDatabase()
  return result(db.transaction(STORES.catalogs).objectStore(STORES.catalogs).get(key))
}

export class WeeklyAccessDenied extends Error {}

export async function downloadWeekly(key: string, farm: string, monday: string, sunday: string): Promise<Snapshot> {
  const fetchedAt = Date.now()
  const parameters = new URLSearchParams({ fincaId: farm, semana: monday })
  const response = await request(`cosechas?${parameters}`)
  if (response.status === 403 || response.status === 409) {
    discardGrant()
    throw new WeeklyAccessDenied('SuiteCRM denegó la consulta de esta finca.')
  }
  if (response.status === 401) throw new WeeklyAccessDenied('Inicia sesión para consultar la semana.')
  if (!response.ok) throw new Error('No se pudo actualizar la semana.')
  const document = await response.json()
  if (!Array.isArray(document.items) || document.items.some((row: WeeklyHarvest) =>
    row?.finca?.id !== farm || !row.crmId || row.id !== row.crmId || !row.recolector?.id
      || row.fecha < monday || row.fecha > sunday
      || !Number.isSafeInteger(row.pesoGramos) || !Number.isSafeInteger(row.tarifaCentavos))) {
    throw new Error('SuiteCRM devolvió recolecciones fuera de la consulta.')
  }
  const snapshot: Snapshot = { items: document.items, fetchedAt }
  const db = await openDatabase()
  const tx = db.transaction(STORES.catalogs, 'readwrite')
  const done = committed(tx)
  const store = tx.objectStore(STORES.catalogs)
  const previous = store.get(key)
  previous.onsuccess = () => {
    if (!previous.result || previous.result.fetchedAt <= fetchedAt) store.put(snapshot, key)
  }
  await done
  return snapshot
}

export function mergeWeekly(local: Harvest[], snapshot: Snapshot | undefined, farm: string, start: string, end: string) {
  const rows = new Map<string, WeeklyHarvest>()
  for (const record of snapshot?.items ?? []) {
    if (record.finca.id === farm && record.fecha >= start && record.fecha <= end && record.crmId) {
      rows.set(record.crmId, record)
    }
  }
  for (const record of local) {
    if (record.finca.id !== farm || record.fecha < start || record.fecha > end) continue
    const key = record.crmId || record.operationId
    if (rows.has(key)) continue
    // Una descarga posterior es la referencia para registros ya confirmados en esa semana.
    if (record.crmId && snapshot && Date.parse(record.syncedAt ?? '') < snapshot.fetchedAt) continue
    rows.set(key, record)
  }
  return [...rows.values()].sort((a, b) => b.fecha.localeCompare(a.fecha) || a.id.localeCompare(b.id))
}

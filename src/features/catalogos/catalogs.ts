import { downloadPages } from '../../shared/pagination'
import { committed, openDatabase, result, STORES } from '../../shared/storage'

export interface CatalogEntry { id: string; nombre: string }
export interface Lote extends CatalogEntry { codigo: string | null; fincaId: string }
export interface Catalogs {
  fincas: CatalogEntry[]
  lotes: Lote[]
  contactos: CatalogEntry[]
  updatedAt: string
}

export async function loadCatalogs(owner: string): Promise<Catalogs | undefined> {
  const db = await openDatabase()
  return result(db.transaction(STORES.catalogs).objectStore(STORES.catalogs).get(owner))
}

export async function refreshCatalogs(owner: string): Promise<Catalogs> {
  const [fincas, contactos] = await Promise.all([
    downloadPages<CatalogEntry>('fincas'),
    downloadPages<CatalogEntry>('contactos'),
  ])
  const lotes: Lote[] = []
  for (const finca of fincas) {
    lotes.push(...await downloadPages<Lote>('lotes', { fincaId: finca.id }))
  }
  const catalogs = { fincas, contactos, lotes, updatedAt: new Date().toISOString() }
  const db = await openDatabase()
  const tx = db.transaction(STORES.catalogs, 'readwrite')
  const done = committed(tx)
  tx.objectStore(STORES.catalogs).put(catalogs, owner)
  await done
  return catalogs
}

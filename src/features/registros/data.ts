import { checkFarmAuthentication, request } from '../../shared/api'
import { committed, openDatabase, result, STORES } from '../../shared/storage'

export type Module = 'fincas' | 'lotes' | 'labores' | 'insumos' | 'cosechas'
export type Fields = {
  nombre: string; codigo?: string; loteId?: string; fecha?: string; tipo?: string; unidad?: string; categoria?: string
  recolectorId?: string; estadoCafe?: string; pesoKg?: string; tarifaKg?: string
}
export type RecordData = Fields & { id: string; version: string }
export type Change = Fields & {
  entity: 'registro'; modulo: Module; owner: string; operationId: string; fincaId: string
  id?: string; version?: string; queuedAt: number; issue?: string; conflict?: boolean; superseded?: boolean; state?: 'confirmed'
}
const key = (owner: string, farm: string, module: Module) => `registros:${owner}:${farm}:${module}`

export async function readRecords(owner: string, farm: string, module: Module) {
  const db = await openDatabase()
  const tx = db.transaction([STORES.catalogs, STORES.operations])
  const [records, operations] = await Promise.all([
    result<RecordData[] | undefined>(tx.objectStore(STORES.catalogs).get(key(owner, farm, module))),
    result<Change[]>(tx.objectStore(STORES.operations).getAll()),
  ])
  return { records: records ?? [], changes: operations.filter(op => op.entity === 'registro' &&
    op.owner === owner && op.fincaId === farm && op.modulo === module).sort((a, b) => a.queuedAt - b.queuedAt) }
}

async function fetchRecords(farm: string, module: Module): Promise<RecordData[]> {
  const response = await request(`registros/${module}?fincaId=${encodeURIComponent(farm)}`)
  checkFarmAuthentication(response)
  if (!response.ok) throw new Error('No se pudieron consultar los registros de la finca.')
  return (await response.json()).registros
}

export async function refreshRecords(owner: string, farm: string, module: Module) {
  const records = await fetchRecords(farm, module)
  const db = await openDatabase()
  const tx = db.transaction(STORES.catalogs, 'readwrite')
  tx.objectStore(STORES.catalogs).put(records, key(owner, farm, module))
  await committed(tx)
}

export async function saveChange(change: Change, previous?: Change) {
  const db = await openDatabase()
  const tx = db.transaction(STORES.operations, 'readwrite')
  const queue = tx.objectStore(STORES.operations)
  queue.put(change)
  if (previous) queue.put({ ...previous, superseded: true })
  await committed(tx)
}

export async function syncRecords(owner: string, farm: string, module: Module) {
  const csrf = await request('auth/csrf')
  if (!csrf.ok) throw new Error('Inicia sesión para sincronizar.')
  const { token, headerName } = await csrf.json()
  const { changes } = await readRecords(owner, farm, module)
  for (const change of changes) {
    if (change.conflict || change.superseded || change.state === 'confirmed') continue
    const { operationId, fincaId, id, version, nombre, codigo, loteId, fecha, tipo, unidad, categoria,
      recolectorId, estadoCafe, pesoKg, tarifaKg } = change
    try {
      const response = await request(`registros/${module}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', [headerName]: token },
        body: JSON.stringify({ operationId, fincaId, id, version, nombre, codigo, loteId, fecha, tipo, unidad, categoria,
          recolectorId, estadoCafe, pesoKg, tarifaKg }),
      })
      if (!response.ok) {
        const conflict = response.status === 409
        const failure = await response.json().catch(() => ({}))
        await saveChange({ ...change, conflict, issue: failure.message ?? `HTTP ${response.status}` })
        if (conflict) await refreshRecords(owner, farm, module)
        break
      }
      const receipt = await response.json()
      if (receipt.operationId !== operationId || receipt.registro?.id !== (id ?? operationId)) throw Error()
      const refreshed = await fetchRecords(farm, module)
      const db = await openDatabase()
      const tx = db.transaction([STORES.catalogs, STORES.operations], 'readwrite')
      tx.objectStore(STORES.catalogs).put(refreshed, key(owner, farm, module))
      tx.objectStore(STORES.operations).put({ ...change, state: 'confirmed' })
      await committed(tx)
    } catch {
      const latest = (await readRecords(owner, farm, module)).changes.find(op => op.operationId === operationId)
      if (!latest?.conflict) await saveChange({ ...change, issue: 'Sin acuse local. Vuelve a intentar al reconectar.' })
      break
    }
  }
}

export async function canCreateFarm() {
  const response = await request('registros/fincas/alta')
  return response.ok && (await response.json()).permitida === true
}

export async function createFarm(owner: string, nombre: string, codigo: string) {
  const csrf = await request('auth/csrf')
  if (!csrf.ok) throw new Error('Inicia sesión para registrar la finca.')
  const { token, headerName } = await csrf.json()
  const attemptKey = `agrosync.finca.alta:${owner}`
  const draft = sessionStorage.getItem(attemptKey)
  const previous = draft && JSON.parse(draft)
  const operationId = previous?.nombre === nombre && previous?.codigo === codigo
    ? previous.operationId : crypto.randomUUID()
  sessionStorage.setItem(attemptKey, JSON.stringify({ operationId, nombre, codigo }))
  const response = await request('registros/fincas/alta', {
    method: 'POST', headers: { 'Content-Type': 'application/json', [headerName]: token },
    body: JSON.stringify({ operationId, nombre, codigo }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.fincaId !== operationId || result.operationId !== operationId) {
    throw new Error(result.message ?? 'No se confirmó el alta de la finca. Puedes reintentar con los mismos datos.')
  }
  sessionStorage.removeItem(attemptKey)
}

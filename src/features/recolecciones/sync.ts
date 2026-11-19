import { request } from '../../shared/api'
import { committed, openDatabase, result, STORES } from '../../shared/storage'
import type { Harvest } from './harvests'

interface Operation {
  operationId: string
  owner: string
  recordId: string
  entity: 'recoleccion'
  type: 'create'
  state: 'pending' | 'confirmed'
  payload: Harvest
}

export async function syncHarvests(owner: string, allowed: (farm: string) => boolean) {
  const db = await openDatabase()
  const operations: Operation[] = await result(db.transaction(STORES.operations).objectStore(STORES.operations).getAll())
  const queue = operations.filter(operation => operation.owner === owner && operation.entity === 'recoleccion'
    && operation.type === 'create' && operation.state === 'pending' && allowed(operation.payload.finca.id))
  if (!queue.length) return 0

  const csrf = await request('auth/csrf')
  if (!csrf.ok) throw new Error('No se pudo verificar la sesión. Tus recolecciones siguen guardadas.')
  const { token, headerName } = await csrf.json()

  let confirmed = 0
  for (const operation of queue) {
    const record = operation.payload
    const response = await request('cosechas/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [headerName]: token },
      body: JSON.stringify({
        operationId: operation.operationId, fincaId: record.finca.id, loteId: record.lote.id,
        recolectorId: record.recolector.id, fecha: record.fecha, estadoCafe: record.estadoCafe,
        pesoGramos: record.pesoGramos, tarifaCentavos: record.tarifaCentavos,
      }),
    }).catch(() => { throw new Error('Se perdió la conexión. Conservamos las operaciones sin confirmar.') })
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}))
      throw new Error(failure.message || 'SuiteCRM no confirmó la operación. Tus pendientes se conservan.')
    }
    const receipt = await response.json()
    if (receipt.operationId !== operation.operationId || receipt.crmId !== operation.operationId) {
      throw new Error('La respuesta no confirma esta recolección. La operación sigue pendiente.')
    }
    await confirm(db, operation, receipt.crmId)
    confirmed++
  }
  return confirmed
}

async function confirm(db: IDBDatabase, operation: Operation, crmId: string) {
  const tx = db.transaction([STORES.harvests, STORES.operations], 'readwrite')
  const done = committed(tx)
  const records = tx.objectStore(STORES.harvests)
  const operations = tx.objectStore(STORES.operations)
  try {
    const [record, queued]: [Harvest | undefined, Operation | undefined] = await Promise.all([
      result(records.get(operation.recordId)), result(operations.get(operation.operationId)),
    ])
    if (!record || !queued || record.owner !== operation.owner || queued.owner !== operation.owner
        || record.operationId !== operation.operationId || queued.recordId !== operation.recordId) {
      throw new Error('No se pudo guardar la confirmación local.')
    }
    if (queued.state !== 'confirmed') {
      const syncedAt = new Date().toISOString()
      records.put({ ...record, crmId, syncedAt })
      operations.put({ ...queued, state: 'confirmed', crmId, syncedAt })
    }
  } catch (failure) {
    try { tx.abort() } catch { /* IndexedDB may have already aborted the transaction. */ }
    await done.catch(() => undefined)
    throw failure
  }
  await done
}

import { checkFarmAuthentication, request } from '../../shared/api'
import { committed, openDatabase, result, STORES } from '../../shared/storage'

type Operation = {
  operationId: string; owner: string; entity: string; fincaId?: string
  payload?: { fincaId?: string; finca?: { id: string } }
  issue?: string; conflict?: boolean; state?: string; discarded?: boolean; superseded?: boolean
}

export async function saveIssue(owner: string, id: string, issue: string, conflict?: boolean) {
  const db = await openDatabase()
  const tx = db.transaction(STORES.operations, 'readwrite')
  const done = committed(tx)
  const queue = tx.objectStore(STORES.operations)
  const op = await result<Operation | undefined>(queue.get(id))
  if (op?.owner === owner && op.state !== 'confirmed') {
    queue.put({ ...op, issue, conflict: conflict ?? op.conflict })
  }
  await done
}

export async function readIssues(owner: string, farms: string[]) {
  const db = await openDatabase()
  const operations = await result<Operation[]>(db.transaction(STORES.operations).objectStore(STORES.operations).getAll())
  return operations.filter(op => op.owner === owner && op.issue)
    .map(op => ({ ...op, farm: op.fincaId ?? op.payload?.fincaId ?? op.payload?.finca?.id ?? '' }))
    .filter(op => farms.includes(op.farm))
}

type Resolution = {
  operationId: string; sourceOperationId: string; relatedOperationId?: string
  owner: string; fincaId: string; entity: 'bitacora-resolucion'; modulo: string
  causa: 'PROPONER_REVISION' | 'CONSERVAR_CENTRAL' | 'DESCARTAR_PENDIENTE'
}

export function enqueueResolution(queue: IDBObjectStore, source: { owner: string; operationId: string; fincaId: string },
                                  modulo: string, causa: Resolution['causa'], relatedOperationId?: string) {
  const resolution: Resolution = { operationId: crypto.randomUUID(), sourceOperationId: source.operationId,
    owner: source.owner, fincaId: source.fincaId, entity: 'bitacora-resolucion', modulo, causa, relatedOperationId }
  queue.add(resolution)
}

export async function flushResolutions(owner: string, farms: string[]) {
  const db = await openDatabase()
  const pending = await result<Resolution[]>(db.transaction(STORES.operations).objectStore(STORES.operations).getAll())
  const queue = pending.filter(op => op.entity === 'bitacora-resolucion' && op.owner === owner && farms.includes(op.fincaId))
  if (!queue.length) return
  const csrf = await request('auth/csrf')
  if (!csrf.ok) return
  const { token, headerName } = await csrf.json()
  for (const entry of queue) {
    const { operationId, sourceOperationId, relatedOperationId, fincaId, modulo, causa } = entry
    const response = await request('bitacora/resoluciones', {
      method: 'POST', headers: { 'Content-Type': 'application/json', [headerName]: token },
      body: JSON.stringify({ intentoId: operationId, operationId: sourceOperationId, relatedOperationId, fincaId, modulo, causa }),
    })
    if (!response.ok) continue
    const tx = db.transaction(STORES.operations, 'readwrite')
    tx.objectStore(STORES.operations).delete(operationId)
    await committed(tx)
  }
}

export type AuditEvent = {
  id: string; intentoId: string; operationId: string; relatedOperationId?: string
  usuario: string; fincaId: string; modulo: string; evento: string; causa?: string; fecha: string
}
export type AuditPage = { eventos: AuditEvent[]; siguiente?: string | null }

export async function readCentralHistory(farm: string, before?: string, operation?: string): Promise<AuditPage> {
  const query = new URLSearchParams({ fincaId: farm })
  if (before) query.set('antes', before)
  if (operation) query.set('operationId', operation)
  const response = await request(`bitacora?${query}`)
  checkFarmAuthentication(response)
  if (!response.ok) throw new Error('No se pudo cargar la bitácora central.')
  const page: AuditPage = await response.json()
  if (!Array.isArray(page.eventos)) throw new Error('La bitácora devolvió una respuesta incompleta.')
  return page
}

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

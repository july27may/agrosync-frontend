import { checkFarmAuthentication, request } from '../../shared/api'
import { committed, openDatabase, result, STORES } from '../../shared/storage'

export type Supply = { id: string; nombre: string; codigo: string; unidad: string; estado: string; saldo: string }
export type Movement = { id: string; insumoId: string; tipo: 'entrada' | 'salida'; cantidad: string; fecha: string; origenId?: string; referencia?: string }
export type Snapshot = { insumos: Supply[]; movimientos: Movement[] }
export type Operation = {
  operationId: string; owner: string; entity: 'inventario'; fincaId: string; insumoId: string;
  tipo: Movement['tipo']; cantidad: string; unidad: string; origenId?: string; referencia: string;
  queuedAt: number; issue?: string; conflict?: boolean; discarded?: boolean; state?: 'confirmed'
}

const key = (owner: string, farm: string) => `inventario:${owner}:${farm}`
export async function readInventory(owner: string, farm: string) {
  const db = await openDatabase()
  const tx = db.transaction([STORES.catalogs, STORES.operations])
  const [snapshot, operations] = await Promise.all([
    result<Snapshot | undefined>(tx.objectStore(STORES.catalogs).get(key(owner, farm))),
    result<Operation[]>(tx.objectStore(STORES.operations).getAll()),
  ])
  return { snapshot, operations: operations.filter(op => op.entity === 'inventario' && op.owner === owner && op.fincaId === farm)
    .sort((first, second) => first.queuedAt - second.queuedAt) }
}

async function store(owner: string, farm: string, snapshot: Snapshot, confirmed?: Operation) {
  const db = await openDatabase()
  const tx = db.transaction([STORES.catalogs, STORES.operations], 'readwrite')
  tx.objectStore(STORES.catalogs).put(snapshot, key(owner, farm))
  if (confirmed) tx.objectStore(STORES.operations).put({ ...confirmed, state: 'confirmed' })
  await committed(tx)
}

async function fetchInventory(farm: string): Promise<Snapshot> {
  const response = await request(`inventario?fincaId=${encodeURIComponent(farm)}`)
  checkFarmAuthentication(response)
  if (!response.ok) throw new Error('No se pudo consultar el inventario autorizado.')
  return response.json()
}

export async function refreshInventory(owner: string, farm: string) {
  await store(owner, farm, await fetchInventory(farm))
}

export async function saveInventory(operation: Operation) {
  const db = await openDatabase()
  const tx = db.transaction(STORES.operations, 'readwrite')
  tx.objectStore(STORES.operations).put(operation)
  await committed(tx)
}

export async function syncInventory(owner: string, farm: string) {
  const { operations } = await readInventory(owner, farm)
  const csrf = await request('auth/csrf')
  if (!csrf.ok) throw new Error('No se pudo verificar la sesión.')
  const { token, headerName } = await csrf.json()
  for (const operation of operations) {
    if (operation.conflict || operation.discarded || operation.state === 'confirmed') continue
    const { operationId, fincaId, insumoId, tipo, cantidad, unidad, origenId, referencia } = operation
    try {
      const response = await request('inventario/movimientos', {
        method: 'POST', headers: { 'Content-Type': 'application/json', [headerName]: token },
        body: JSON.stringify({ operationId, fincaId, insumoId, tipo, cantidad, unidad, origenId, referencia,
          fecha: new Date(operation.queuedAt).toISOString() }),
      })
      if (!response.ok) {
        const conflict = response.status === 409
        const failure = await response.json().catch(() => ({}))
        await saveInventory({ ...operation, conflict, issue: failure.message ?? `Envío rechazado (HTTP ${response.status}).` })
        if (conflict) await refreshInventory(owner, farm).catch(() => {})
        break
      }
      const receipt = await response.json()
      if (receipt.operationId !== operationId || receipt.crmId !== operationId) throw new Error('Acuse inesperado.')
      await store(owner, farm, await fetchInventory(farm), operation)
    } catch {
      await saveInventory({ ...operation, issue: 'Sin confirmación local. Puedes volver a intentar.' })
      break
    }
  }
}

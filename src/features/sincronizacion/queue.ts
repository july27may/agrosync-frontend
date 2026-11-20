import { locked, serverUser, type User } from '../auth/auth'
import { syncLivestock } from '../ganaderia/data'
import { flushResolutions } from '../incidencias/incidents'
import { syncInventory } from '../inventario/data'
import { syncHarvests } from '../recolecciones/sync'
import { syncRecords, type Module } from '../registros/data'
import { openDatabase, result, STORES } from '../../shared/storage'

type Queued = {
  operationId: string; owner: string; entity: string; fincaId?: string; id?: string; modulo?: Module; origenId?: string
  state?: string; conflict?: boolean; discarded?: boolean; superseded?: boolean
  payload?: { fincaId?: string; finca?: { id: string } }
}

export type SyncResult = { confirmed: number; remaining: number; issue?: string; retry?: boolean; expired?: boolean }
let running = false

async function readOperations(owner: string) {
  const db = await openDatabase()
  const rows = await result<Queued[]>(db.transaction(STORES.operations).objectStore(STORES.operations).getAll())
  return rows.filter(row => row.owner === owner)
}

const awaiting = (row: Queued) => row.state !== 'confirmed' && !row.discarded && !row.superseded
const farmId = (row: Queued) => row.fincaId ?? row.payload?.fincaId ?? row.payload?.finca?.id ?? ''
const writes = (role?: User['permisos'][string]) => role === 'ADMINISTRADOR_FINCA' || role === 'REGISTRADOR'
const modules: Module[] = ['fincas', 'lotes', 'labores', 'insumos', 'cosechas', 'animales', 'eventos']

async function run(owner: string, manual: boolean): Promise<SyncResult> {
  const before = await readOperations(owner)
  const pending = before.filter(awaiting)
  const empty = { confirmed: 0, remaining: pending.length }
  if (!pending.length || !navigator.onLine || locked()) return empty
  let user: User | undefined
  try {
    // auth/me proves both Java availability and the current delegated permissions in SuiteCRM.
    user = await serverUser()
  } catch {
    return { ...empty, retry: true, issue: 'No se pudo verificar la conexión con Java y SuiteCRM. Se conservan los pendientes.' }
  }
  if (user?.id !== owner) return { ...empty, expired: true }
  if (locked() || !navigator.onLine) return empty
  const current = user
  const eligible = pending.filter(row => {
    const role = current.permisos[farmId(row)]
    if (!writes(role)) return false
    if (row.conflict && (!manual || (row.entity !== 'recoleccion' && row.entity !== 'animal' && row.entity !== 'evento-sanitario'))) return false
    if (row.entity === 'animal' || (row.entity === 'inventario' && row.origenId)) return role === 'ADMINISTRADOR_FINCA'
    if (row.entity === 'registro') return role === 'ADMINISTRADOR_FINCA' || (row.modulo === 'labores' && !row.id)
    return true
  })
  let issue: string | undefined

  async function attempt(work: () => Promise<unknown>) {
    if (locked() || !navigator.onLine) return
    try {
      await work()
    } catch (failure) {
      issue ??= failure instanceof Error ? failure.message : 'No se pudo sincronizar. Se conservan los pendientes.'
    }
  }

  if (eligible.some(row => row.entity === 'bitacora-resolucion')) {
    await attempt(() => flushResolutions(owner, Object.keys(current.permisos).filter(id => writes(current.permisos[id]))))
  }
  if (eligible.some(row => row.entity === 'recoleccion')) {
    await attempt(() => syncHarvests(owner, id => writes(current.permisos[id]), manual))
  }
  for (const farm of new Set(eligible.map(farmId))) {
    const rows = eligible.filter(row => farmId(row) === farm)
    const admin = current.permisos[farm] === 'ADMINISTRADOR_FINCA'
    if (rows.some(row => row.entity === 'animal' || row.entity === 'evento-sanitario')) {
      await attempt(() => syncLivestock(owner, farm, kind => kind === 'evento-sanitario' || admin, manual))
    }
    for (const module of modules) {
      if (rows.some(row => row.entity === 'registro' && row.modulo === module)) {
        await attempt(() => syncRecords(owner, farm, module, change => admin || (module === 'labores' && !change.id)))
      }
    }
    if (rows.some(row => row.entity === 'inventario')) {
      await attempt(() => syncInventory(owner, farm, movement => !movement.origenId || admin))
    }
  }
  const after = await readOperations(owner)
  const previouslyConfirmed = new Set(before.filter(row => row.state === 'confirmed').map(row => row.operationId))
  const completed = after.filter(row => row.state === 'confirmed' && !previouslyConfirmed.has(row.operationId)).length
  const remainingIds = new Set(after.map(row => row.operationId))
  const resolutions = eligible.filter(row => row.entity === 'bitacora-resolucion' && !remainingIds.has(row.operationId)).length
  const confirmed = completed + resolutions
  return { confirmed, remaining: after.filter(awaiting).length, issue }
}

export async function synchronize(owner: string, manual: boolean): Promise<SyncResult | undefined> {
  if (running) return
  running = true
  try {
    if (navigator.locks) {
      return await navigator.locks.request('agrosync-sync', () => run(owner, manual))
    }
    return await run(owner, manual)
  } finally {
    running = false
  }
}

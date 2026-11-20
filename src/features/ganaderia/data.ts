import type { CatalogEntry } from '../catalogos/catalogs'
import { saveIssue } from '../incidencias/incidents'
import { request } from '../../shared/api'
import { downloadPages } from '../../shared/pagination'
import { committed, openDatabase, result, STORES } from '../../shared/storage'

export interface AnimalDraft {
  fincaId: string
  codigo: string
  nombre: string
  sexo: string
  categoria: string | null
  nacimiento: string | null
  registrarNacimiento?: boolean
  madreId: string | null
  raza: string | null
  estado: string
}

export interface EventDraft {
  fincaId: string
  animalId: string
  nombre: string
  fecha: string
  tipo: string
  producto: string | null
  responsableId: string | null
  certificado: string | null
  observaciones: string | null
}

interface Saved { id: string; owner?: string; crmId?: string }
export type Animal = AnimalDraft & Saved
export type HealthEvent = EventDraft & Saved
interface Snapshot {
  fincas: CatalogEntry[]
  contactos: CatalogEntry[]
  animales: Animal[]
  eventos: HealthEvent[]
}
export const EMPTY: Snapshot = { fincas: [], contactos: [], animales: [], eventos: [] }

type Operation = (
  { entity: 'animal'; payload: Animal } | { entity: 'evento-sanitario'; payload: HealthEvent }
) & { operationId: string; owner: string; state: 'pending' | 'confirmed'; issue?: string; conflict?: boolean }

export async function fetchSnapshot(owner: string) {
  const [fincas, contactos] = await Promise.all([
    downloadPages<CatalogEntry>('fincas'),
    downloadPages<CatalogEntry>('contactos').catch(async () => {
      const db = await openDatabase()
      const stored: Snapshot | undefined = await result(db.transaction(STORES.catalogs)
        .objectStore(STORES.catalogs).get(`ganaderia:${owner}`))
      return stored?.contactos ?? []
    }),
  ])
  const snapshot: Snapshot = { ...EMPTY, fincas, contactos, animales: [], eventos: [] }
  for (const farm of fincas) {
    const response = await request(`ganaderia?${new URLSearchParams({ fincaId: farm.id })}`)
    if (!response.ok) throw new Error('No se pudo actualizar la Ganadería de ' + farm.nombre + '.')
    const document: Pick<Snapshot, 'animales' | 'eventos'> = await response.json()
    if (!Array.isArray(document.animales) || !Array.isArray(document.eventos)
        || [...document.animales, ...document.eventos].some(record => record.fincaId !== farm.id)) {
      throw new Error('SuiteCRM devolvió referencias de finca inesperadas.')
    }
    snapshot.animales.push(...document.animales.map(record => ({ ...record, crmId: record.id })))
    snapshot.eventos.push(...document.eventos.map(record => ({ ...record, crmId: record.id })))
  }
  const db = await openDatabase()
  const tx = db.transaction(STORES.catalogs, 'readwrite')
  const done = committed(tx)
  tx.objectStore(STORES.catalogs).put(snapshot, `ganaderia:${owner}`)
  await done
}

function merge<T extends Saved>(central: T[], local: T[], owner: string): T[] {
  const records = new Map(central.map(row => [row.id, row]))
  for (const row of local) {
    if (row.owner === owner && (!row.crmId || !records.has(row.id))) records.set(row.id, row)
  }
  return [...records.values()]
}

export async function readSnapshot(owner: string): Promise<Snapshot> {
  const db = await openDatabase()
  const tx = db.transaction([STORES.catalogs, STORES.animals, STORES.events])
  const [data, animals, events]: [Snapshot | undefined, Animal[], HealthEvent[]] = await Promise.all([
    result(tx.objectStore(STORES.catalogs).get(`ganaderia:${owner}`)),
    result(tx.objectStore(STORES.animals).getAll()),
    result(tx.objectStore(STORES.events).getAll()),
  ])
  const snapshot = data ?? EMPTY
  return { ...snapshot, animales: merge(snapshot.animales, animals, owner), eventos: merge(snapshot.eventos, events, owner) }
}

export async function saveAnimal(owner: string, draft: AnimalDraft) {
  const animal = { ...draft, id: crypto.randomUUID(), owner }
  await enqueue({ entity: 'animal', payload: animal, owner, operationId: animal.id, state: 'pending' })
}

export async function saveEvent(owner: string, draft: EventDraft) {
  const event = { ...draft, id: crypto.randomUUID(), owner }
  await enqueue({ entity: 'evento-sanitario', payload: event, owner, operationId: event.id, state: 'pending' })
}

function entityStore(entity: Operation['entity']) {
  return entity === 'animal' ? STORES.animals : STORES.events
}

async function enqueue(operation: Operation) {
  const db = await openDatabase()
  const store = entityStore(operation.entity)
  const tx = db.transaction([store, STORES.operations], 'readwrite')
  const done = committed(tx)
  tx.objectStore(store).add(operation.payload)
  tx.objectStore(STORES.operations).add(operation)
  await done
}

export async function syncLivestock(owner: string, farm: string, canWrite: (entity: Operation['entity']) => boolean) {
  const db = await openDatabase()
  const stored: Operation[] = await result(db.transaction(STORES.operations).objectStore(STORES.operations).getAll())
  const queue = stored.filter(operation =>
    (operation.entity === 'animal' || operation.entity === 'evento-sanitario')
      && operation.state === 'pending' && operation.owner === owner && operation.payload.fincaId === farm)
  const pending = new Map(queue.map(operation => [operation.operationId, operation]))
  const syncing = new Set<string>()
  const snapshot = await readSnapshot(owner)
  const knownAnimals = new Set(snapshot.animales
    .filter(animal => animal.fincaId === farm && animal.crmId).map(animal => animal.id))
  if (!queue.length) return 0

  const csrf = await request('auth/csrf')
  if (!csrf.ok) throw new Error('No se pudo verificar la sesión.')
  const { token, headerName } = await csrf.json()
  let confirmed = 0

  async function send(operation: Operation) {
    const id = operation.operationId
    if (!pending.has(id)) return
    if (!canWrite(operation.entity)) throw new Error('El perfil vigente no puede enviar este registro.')
    if (syncing.has(id)) throw new Error('Hay un ciclo entre referencias de animales.')
    syncing.add(id)
    const dependency = operation.entity === 'animal' ? operation.payload.madreId : operation.payload.animalId
    if (dependency && !knownAnimals.has(dependency)) {
      const parent = pending.get(dependency)
      if (!parent || parent.entity !== 'animal') throw new Error('Falta confirmar el animal de referencia.')
      await send(parent)
    }

    const { id: _id, owner: _owner, crmId: _crmId, ...body } = operation.payload
    const resource = operation.entity === 'animal' ? 'animales' : 'eventos'
    const response = await request(`ganaderia/${resource}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [headerName]: token },
      body: JSON.stringify({ ...body, operationId: id }),
    })
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}))
      const message = failure.message || 'SuiteCRM no confirmó el registro. Se conservan los pendientes.'
      await saveIssue(owner, id, message, response.status === 409)
      throw new Error(message)
    }
    const receipt = await response.json()
    if (receipt.operationId !== id || receipt.crmId !== id) throw new Error('Acuse ganadero inesperado.')
    const store = entityStore(operation.entity)
    const tx = db.transaction([store, STORES.operations], 'readwrite')
    const done = committed(tx)
    tx.objectStore(store).put({ ...operation.payload, crmId: id })
    tx.objectStore(STORES.operations).put({ ...operation, state: 'confirmed', crmId: id })
    await done
    if (operation.entity === 'animal') knownAnimals.add(id)
    pending.delete(id)
    syncing.delete(id)
    confirmed++
  }

  for (const operation of queue) {
    try {
      await send(operation)
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'El envío ganadero quedó sin confirmar.'
      if (!operation.issue) await saveIssue(owner, operation.operationId, message, operation.conflict)
      throw failure
    }
  }
  return confirmed
}

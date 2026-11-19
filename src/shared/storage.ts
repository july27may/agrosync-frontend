export const STORES = {
  catalogs: 'catalogos',
  harvests: 'recolecciones',
  operations: 'operacionesPendientes',
  animals: 'animales',
  events: 'eventosSanitarios',
} as const

let connection: Promise<IDBDatabase> | undefined

export function openDatabase(): Promise<IDBDatabase> {
  if (!connection) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('agrosync', 2)
      request.onupgradeneeded = event => {
        const db = request.result
        if (event.oldVersion < 1) {
          db.createObjectStore(STORES.catalogs)
          db.createObjectStore(STORES.harvests, { keyPath: 'id' })
          db.createObjectStore(STORES.operations, { keyPath: 'operationId' })
        }
        if (event.oldVersion < 2) {
          db.createObjectStore(STORES.animals, { keyPath: 'id' })
          db.createObjectStore(STORES.events, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          connection = undefined
        }
        resolve(db)
      }
      request.onerror = () => reject(request.error)
    })
    connection = opening.catch(error => {
      connection = undefined
      throw error
    })
  }
  return connection
}

export function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('Transacción cancelada'))
  })
}

import { expect, test } from '@playwright/test'

test('la actualización agrega la ganadería y conserva el café de IndexedDB v1', async ({ page }) => {
  const origin = 'http://127.0.0.1:5173'
  await page.route(origin + '/semilla-prueba', route => route.fulfill({ body: '<title>Migración de prueba</title>', contentType: 'text/html' }))
  await page.route('http://127.0.0.1:8081/api/v1/**', route => {
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ headers, json: path.endsWith('/auth/me')
      ? { id: 'usuario-migracion', username: 'Prueba migración', permisos: { finca: 'ADMINISTRADOR_FINCA' } }
      : { items: [], page: 1, totalPages: null } })
  })
  await page.goto(origin + '/semilla-prueba')
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('agrosync', 1)
      open.onupgradeneeded = () => {
        const db = open.result
        db.createObjectStore('catalogos')
        db.createObjectStore('recolecciones', { keyPath: 'id' })
        db.createObjectStore('operacionesPendientes', { keyPath: 'operationId' })
        const data = open.transaction!
        const finca = { id: 'finca', nombre: 'Finca de prueba' }
        const record = {
          id: 'registro-previo', owner: 'usuario-migracion', operationId: 'operacion-previa',
          finca, lote: { id: 'lote', nombre: 'Lote de prueba' },
          recolector: { id: 'persona', nombre: 'Recolector previo de prueba' },
          fecha: '2026-11-19', pesoGramos: 1000, tarifaCentavos: 500,
          estadoCafe: 'cereza', createdAt: '2026-11-19T12:00:00.000Z',
        }
        data.objectStore('recolecciones').add(record)
        data.objectStore('operacionesPendientes').add({ operationId: record.operationId,
          owner: record.owner, recordId: record.id, entity: 'recoleccion', type: 'create', state: 'pending', payload: record })
      }
      open.onsuccess = () => { open.result.close(); resolve() }
      open.onerror = () => reject(open.error)
    })
  })
  await page.goto(origin)
  await expect(page.getByRole('row', { name: /Recolector previo de prueba/ })).toContainText('Pendiente de sincronizar')
  const stores = await page.evaluate(async () => new Promise<{ version: number; names: string[]; state: string }>((resolve, reject) => {
    const open = indexedDB.open('agrosync')
    open.onsuccess = () => {
      const db = open.result
      const query = db.transaction('operacionesPendientes').objectStore('operacionesPendientes').get('operacion-previa')
      query.onsuccess = () => {
        resolve({ version: db.version, names: Array.from(db.objectStoreNames), state: query.result.state })
        db.close()
      }
      query.onerror = () => reject(query.error)
    }
    open.onerror = () => reject(open.error)
  }))
  expect(stores).toEqual({ version: 2, state: 'pending',
    names: ['animales', 'catalogos', 'eventosSanitarios', 'operacionesPendientes', 'recolecciones'] })
})

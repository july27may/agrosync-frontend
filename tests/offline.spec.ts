import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { generateKeyPairSync, sign } from 'node:crypto'
import { join } from 'node:path'

const app = 'http://127.0.0.1:5173'
const api = 'http://127.0.0.1:8081/api/v1'

async function readStores(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('agrosync')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      const read = (store: string) => new Promise<any[]>((resolve, reject) => {
        const query = db.transaction(store).objectStore(store).getAll()
        query.onsuccess = () => resolve(query.result)
        query.onerror = () => reject(query.error)
      })
      const [records, operations, catalogs] = await Promise.all([
        read('recolecciones'), read('operacionesPendientes'), read('catalogos'),
      ])
      return { records, operations, catalogs }
    } finally {
      db.close()
    }
  })
}

test('descarga, captura offline, confirma atomicidad y recupera al reabrir Chromium', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agrosync-offline-'))
  const launch = () => chromium.launchPersistentContext(profile, {
    headless: true, executablePath: process.env.CHROME_PATH, locale: 'es-CO',
  })
  let context = await launch()
  try {
    const requests: string[] = []
    const user = { id: 'usuario-prueba', username: 'registro', permisos: { a: 'CONSULTA', b: 'REGISTRADOR' } }
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    let authenticated = false
    let syncAttempts = 0
    let expiry = 0
    const mockProvider = (active: BrowserContext) => active.route(`${api}/**`, async route => {
      const url = new URL(route.request().url())
      const headers = { 'Access-Control-Allow-Origin': app, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'content-type,x-csrf-token', 'Access-Control-Allow-Methods': 'GET,POST' }
      const method = route.request().method()
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
      if (url.pathname.endsWith('/auth/csrf')) return route.fulfill({ headers, json: { token: 'prueba', headerName: 'X-CSRF-TOKEN' } })
      if (url.pathname.endsWith('/auth/me')) return route.fulfill({ headers, status: authenticated ? 200 : 401, json: authenticated ? user : {} })
      if (url.pathname.endsWith('/auth/login')) {
        authenticated = method === 'GET'
        requests.push('inicio-suitecrm')
        return route.fulfill({ headers: { ...headers, location: app + '/' }, status: 303 })
      }
      if (url.pathname.endsWith('/auth/offline')) {
        const deviceId = new URLSearchParams(route.request().postData() ?? '').get('deviceId')
        const issuedAt = Date.now()
        requests.push('permiso-emitido')
        expiry = issuedAt + 90 * 60 * 1000
        const payload = Buffer.from(JSON.stringify({ user, deviceId, issuedAt, expiresAt: expiry }))
        return route.fulfill({ headers, json: { payload: payload.toString('base64url'),
          signature: sign('sha256', payload, { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
          publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') } })
      }
      if (url.pathname.endsWith('/cosechas/sync')) {
        syncAttempts += 1
        if (syncAttempts === 1) return route.fulfill({ headers, status: 503, json: { message: 'SuiteCRM no confirmó.' } })
        const { operationId } = JSON.parse(route.request().postData() ?? '{}')
        return route.fulfill({ headers, json: { operationId, crmId: operationId } })
      }
      const page = Number(url.searchParams.get('page'))
      const fincaId = url.searchParams.get('fincaId')
      requests.push(`${url.pathname}|${page}|${fincaId || ''}`)
      const path = url.pathname.split('/').at(-1)
      const items = path === 'fincas' ? [
        { id: 'a', nombre: 'Finca de prueba A' }, { id: 'b', nombre: 'Finca de prueba B' },
      ] : path === 'lotes' ? [
        { id: `lote-${fincaId}`, nombre: `Lote de prueba ${fincaId?.toUpperCase()}`, codigo: 'PRUEBA', fincaId },
      ] : [{ id: `contacto-${page}`, nombre: `Recolector de prueba ${page}` }]
      await route.fulfill({ headers, json: { items, page, size: 100, recordsOnPage: items.length, totalPages: path === 'contactos' ? 2 : 1 } })
    })
    await mockProvider(context)
    context.setDefaultTimeout(7000)
    let page = context.pages()[0]
    await page.goto(app)
    await page.getByRole('button', { name: 'Ingresar con SuiteCRM' }).click()
    expect(requests).toContain('inicio-suitecrm')
    await page.getByRole('button', { name: 'Preparar dispositivo offline' }).click()
    await expect(page.getByText('Listo para trabajar sin conexión')).toBeVisible()
    expect(requests).toContain('/api/v1/contactos|2|')
    expect(requests).toContain('/api/v1/lotes|1|a')
    expect(requests).toContain('/api/v1/lotes|1|b')

    await context.setOffline(true)
    await expect(page.getByText('Sin conexión', { exact: true })).toBeVisible()
    const farms = page.getByRole('combobox', { name: 'Finca', exact: true })
    await expect(farms.locator('option')).toHaveText(['Selecciona una finca', 'Finca de prueba B'])
    await farms.selectOption('b')
    const lot = page.getByRole('combobox', { name: 'Lote', exact: true })
    await expect(lot.locator('option')).toHaveText(['Selecciona un lote', 'Lote de prueba B'])
    await lot.selectOption('lote-b')
    await page.getByRole('combobox', { name: 'Recolector', exact: true }).selectOption('contacto-2')
    await page.getByLabel('Fecha de recolección').fill('2026-11-19')
    await page.getByLabel('Semana de la fecha').fill('2026-11-19')
    await page.getByLabel('Cantidad (kg)').fill('0')
    await page.getByLabel('Tarifa por kilogramo (COP)').fill('1500,00')
    await page.getByRole('combobox', { name: 'Estado del café' }).selectOption('cereza')
    await page.getByRole('button', { name: 'Guardar recolección' }).click()
    await expect(page.getByRole('alert')).toHaveText(/valores positivos/)
    expect((await readStores(page)).records).toHaveLength(0)

    await page.getByLabel('Cantidad (kg)').fill('2,500')
    await page.getByRole('button', { name: 'Guardar recolección' }).click()
    await expect(page.getByText('Guardado localmente. Pendiente de sincronizar.')).toBeVisible()
    await expect(page.getByTestId('weekly-total')).toHaveText(/3[.\s]?750,00 COP/)
    const stored = await readStores(page)
    expect(stored.records).toHaveLength(1)
    expect(stored.operations).toHaveLength(1)
    expect(stored.operations[0]).toMatchObject({
      recordId: stored.records[0].id, operationId: stored.records[0].operationId, state: 'pending',
    })
    expect(stored.records[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(stored.records[0].operationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(stored.records[0].operationId).not.toBe(stored.records[0].id)
    expect(stored.catalogs[0].lotes).toHaveLength(2)
    const originalGrant = await page.evaluate(() => localStorage.getItem('agrosync.authorization'))
    expect(originalGrant).not.toBeNull()

    await page.evaluate(existing => {
      let calls = 0
      const real = crypto.randomUUID.bind(crypto)
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true, value: () => (++calls === 2 ? existing : real()),
      })
    }, stored.operations[0].operationId)
    await page.getByLabel('Cantidad (kg)').fill('1')
    await page.getByRole('button', { name: 'Guardar recolección' }).click()
    await expect(page.getByRole('alert')).toHaveText(/No se pudo guardar/)
    expect(await readStores(page)).toEqual(stored)

    await context.close()
    context = await launch()
    context.setDefaultTimeout(7000)
    await context.setOffline(true)
    page = context.pages()[0]
    await page.goto(app)
    await expect(page.getByText('Sin conexión', { exact: true })).toBeVisible()
    await expect(page.getByRole('row', { name: /Recolector de prueba 2/ })).toBeVisible()
    await expect(page.getByText('Pendiente de sincronizar', { exact: true })).toBeVisible()
    await page.getByLabel('Semana de la fecha').fill('2026-11-19')
    await expect(page.getByTestId('weekly-total')).toHaveText(/3[.\s]?750,00 COP/)
    expect(await readStores(page)).toEqual(stored)
    expect(await page.evaluate(() => localStorage.getItem('agrosync.authorization'))).toBe(originalGrant)
    expect(requests.filter(item => item === 'permiso-emitido')).toHaveLength(1)
    await page.clock.setFixedTime(expiry + 1000)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Tus registros pendientes se conservan')
    expect(await readStores(page)).toEqual(stored)
    expect(await page.evaluate(() => localStorage.getItem('agrosync.authorization'))).toBe(originalGrant)

    authenticated = false
    await mockProvider(context)
    await context.setOffline(false)
    await page.getByRole('button', { name: 'Ingresar con SuiteCRM' }).click()
    await expect(page.getByRole('row', { name: /Recolector de prueba 2/ })).toBeVisible()
    await expect(page.getByText('Pendiente de sincronizar', { exact: true })).toBeVisible()
    expect(await readStores(page)).toEqual(stored)
    expect(requests.filter(item => item === 'permiso-emitido')).toHaveLength(1)
    const sync = page.getByRole('button', { name: 'Sincronizar recolecciones' })
    await sync.click()
    await expect(page.getByRole('alert')).toContainText('SuiteCRM no confirmó')
    expect(await readStores(page)).toEqual(stored)
    await sync.click()
    await expect(page.getByText('Confirmado en SuiteCRM', { exact: true })).toBeVisible()
    const confirmed = await readStores(page)
    expect(confirmed.records[0].crmId).toBe(stored.records[0].operationId)
    expect(confirmed.operations[0].state).toBe('confirmed')
    expect(syncAttempts).toBe(2)
  } finally {
    await context.close()
    await rm(profile, { recursive: true, force: true })
  }
})

import { expect, test, type Locator } from '@playwright/test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('pagina Ganadería, Inventario e Incidencias con controles independientes', async ({ page, context }) => {
  const origin = 'http://127.0.0.1:5173'
  const api = 'http://127.0.0.1:8081/api/v1'
  const user = { id: 'prueba-tablas', username: 'Prueba', permisos: { a: 'ADMINISTRADOR_FINCA', b: 'CONSULTA' } }
  const farms = [{ id: 'a', nombre: 'Finca de prueba A' }, { id: 'b', nombre: 'Finca de prueba B' }]
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const indices = Array.from({ length: 12 }, (_, index) => index + 1)
  const animals = indices.map(n => ({
    id: `animal-${n}`, fincaId: 'a', codigo: `A-${n}`, nombre: `Animal ${n}`, sexo: 'hembra', categoria: 'vaca',
    nacimiento: null, raza: null, madreId: n === 1 ? 'animal-12' : null, estado: 'activo',
  }))
  const events = indices.map(n => ({
    id: `evento-${n}`, fincaId: 'a', animalId: 'animal-12', nombre: `Evento ${n}`,
    fecha: '2026-11-19', tipo: 'revision', producto: null, responsableId: null, certificado: null, observaciones: null,
  }))
  const supplies = indices.map(n => ({ id: `insumo-${n}`, nombre: `Insumo ${n}`, codigo: `I-${n}`,
    unidad: 'kg', estado: 'activo', saldo: '10.000' }))
  const movements = indices.map(n => ({ id: `movimiento-${n}`, insumoId: `insumo-${n}`, tipo: 'entrada',
    cantidad: '10.000', fecha: '2026-11-19T12:00:00Z', origenId: n === 12 ? 'movimiento-1' : undefined }))
  const audit = indices.map(n => ({ id: `auditoria-${n}`, operationId: `operacion-${n}`, usuario: 'Prueba', fincaId: 'a',
    modulo: 'inventario/movimientos', evento: 'CONFIRMADO', fecha: '2026-11-19T12:00:00Z' }))

  await page.route(`${api}/**`, route => {
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'content-type,x-csrf-token', 'Access-Control-Allow-Methods': 'GET,POST' }
    const json = (data: unknown) => route.fulfill({ headers, json: data })
    const url = new URL(route.request().url())
    const path = url.pathname.split('/').at(-1)
    const farm = url.searchParams.get('fincaId')
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === 'me') return json(user)
    if (path === 'csrf') return json({ token: 'prueba', headerName: 'X-CSRF-TOKEN' })
    if (path === 'offline') {
      const deviceId = new URLSearchParams(route.request().postData() ?? '').get('deviceId')
      const issuedAt = Date.now()
      const payload = Buffer.from(JSON.stringify({ user, deviceId, issuedAt, expiresAt: issuedAt + 3600000 }))
      return json({ payload: payload.toString('base64url'),
        signature: sign('sha256', payload, { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
        publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') })
    }
    if (path === 'ganaderia') {
      return json(farm === 'a' ? { animales: animals, eventos: events } : {
        animales: [{ ...animals[0], fincaId: 'b', id: 'animal-b', nombre: 'Animal Finca B' }], eventos: [],
      })
    }
    if (path === 'inventario') return json(farm === 'a'
      ? { insumos: supplies, movimientos: movements } : { insumos: [], movimientos: [] })
    if (path === 'bitacora') return json(url.searchParams.has('antes')
      ? { eventos: audit.slice(10), siguiente: null } : { eventos: audit.slice(0, 10), siguiente: 'cursor-prueba' })
    return json({ items: path === 'fincas' ? farms : [], page: 1, totalPages: 1 })
  })

  function table(region: string) {
    const section = page.getByRole('region', { name: region, exact: true })
    return {
      size: section.getByRole('combobox', { name: 'Registros por página' }),
      rows: section.getByRole('table').locator('tbody tr'),
      nav: section.getByRole('navigation'),
    }
  }

  async function checkFive(list: ReturnType<typeof table>) {
    await expect(list.size).toHaveValue('10')
    await expect(list.size.locator('option')).toHaveText(['5', '10', '20', '50'])
    await expect(list.rows).toHaveCount(10)
    await list.size.selectOption('5')
    await expect(list.rows).toHaveCount(5)
    await list.nav.getByRole('button', { name: 'Siguiente' }).click()
    await expect(list.nav).toContainText('Mostrando 6–10')
  }

  async function exportCount(button: Locator, count: number) {
    const download = page.waitForEvent('download')
    await button.click()
    const csv = await readFile(await (await download).path(), 'utf8')
    expect(csv.split('\r\n')).toHaveLength(count + 1)
  }

  await page.goto(origin)
  await expect(page.getByText('Listo para trabajar sin conexión')).toBeVisible()
  await page.getByRole('button', { name: 'Ganadería', exact: true }).click()
  const livestock = table('Animales')
  const health = table('Eventos sanitarios')
  await expect(livestock.rows.first()).toContainText('Animal 12')
  await checkFive(livestock)
  await checkFive(health)
  await health.nav.getByRole('button', { name: 'Siguiente' }).click()
  await expect(health.rows.first()).toContainText('Evento 11')
  await expect(health.rows.first()).toContainText('Animal 12')
  await expect(livestock.nav).toContainText('Página 2 de 3')
  await exportCount(page.getByRole('button', { name: 'Exportar historial sanitario' }), 12)
  await page.getByLabel('Finca ganadera').selectOption('b')
  await expect(livestock.rows).toHaveCount(1)
  await expect(livestock.rows.first()).toContainText('Animal Finca B')
  await page.getByLabel('Finca ganadera').selectOption('a')
  await expect(livestock.size).toHaveValue('5')
  await expect(livestock.nav).toContainText('Página 1 de 3')

  await page.getByRole('button', { name: 'Inventario', exact: true }).click()
  const stock = table('Existencias')
  const history = table('Historial')
  await checkFive(stock)
  await checkFive(history)
  await history.nav.getByRole('button', { name: 'Anterior' }).click()
  await expect(history.rows.first().getByRole('button', { name: 'Compensar' })).toHaveCount(0)
  await exportCount(page.getByRole('button', { name: 'Exportar movimientos confirmados' }), 12)
  await context.setOffline(true)
  await expect(page.getByText('Sin conexión', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Insumo', exact: true }).selectOption('insumo-12')
  await page.getByLabel('Cantidad', { exact: true }).fill('2')
  await page.getByRole('button', { name: 'Guardar movimiento' }).click()
  await expect(history.rows.first()).toContainText('Pendiente de sincronizar')
  await stock.size.selectOption('20')
  await expect(stock.rows).toHaveCount(12)
  await expect(stock.rows.last()).toContainText('12.000')

  await page.evaluate(async ids => {
    const open = indexedDB.open('agrosync')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('operacionesPendientes', 'readwrite')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        const store = tx.objectStore('operacionesPendientes')
        for (const id of ids) store.put({ operationId: `incidencia-${id}`, owner: 'prueba-tablas', entity: 'registro',
          fincaId: 'a', issue: 'Conflicto ficticio de prueba.', conflict: true })
      })
    } finally { db.close() }
  }, indices)

  await page.getByRole('button', { name: 'Incidencias', exact: true }).click()
  await checkFive(table('Incidencias de este dispositivo'))
  await context.setOffline(false)
  const central = table('Bitácora central')
  await checkFive(central)
  await expect(central.nav).toContainText('Página 2 de 2')
  await page.getByRole('button', { name: 'Ver anteriores' }).click()
  await expect(central.nav).toContainText('de 12')
  await central.nav.getByRole('button', { name: 'Siguiente' }).click()
  await expect(central.rows.last()).toContainText('operacion-12')
})

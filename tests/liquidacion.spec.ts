import { expect, test } from '@playwright/test'

test('liquida por finca y semana, incluye pendientes y evita duplicados al consultar sin red', async ({ page, context }) => {
  const origin = 'http://127.0.0.1:5173'
  const A = { id: 'a', nombre: 'Finca A de prueba' }
  const B = { id: 'b', nombre: 'Finca B de prueba' }
  const R1 = { id: 'r1', nombre: 'Recolector uno de prueba' }
  const R2 = { id: 'r2', nombre: 'Recolector dos de prueba' }
  const lot = { id: 'lote-a', nombre: 'Lote de prueba' }
  const row = (id: string, finca: typeof A, recolector: typeof R1, grams: number, cents: number, fecha = '2026-11-19') =>
    ({ id, crmId: id, finca, lote: lot, recolector, fecha, pesoGramos: grams, tarifaCentavos: cents, estadoCafe: 'cereza' })
  const central = [row('operacion-dup', A, R1, 2000, 100000), row('central-solamente', A, R2, 3000, 60000)]
  const local = [
    { ...row('copia-local', A, R1, 2000, 100000), crmId: undefined, operationId: 'operacion-dup' },
    { ...row('pendiente', A, R2, 1000, 50000), crmId: undefined, operationId: 'operacion-pendiente' },
    { ...row('otra-semana', A, R1, 1000, 40000, '2026-11-12'), crmId: undefined, operationId: 'op-otra-semana' },
  ].map(record => ({ ...record, owner: 'prueba-semanal', createdAt: record.fecha }))
  const consultations: string[] = []

  await page.route(origin + '/semana-prueba', route => route.fulfill({ body: '<title>Datos semanales de prueba</title>', contentType: 'text/html' }))
  await page.route('http://127.0.0.1:8081/api/v1/**', async route => {
    const url = new URL(route.request().url())
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'content-type,x-csrf-token', 'Access-Control-Allow-Methods': 'GET,POST' }
    const json = (data: unknown) => route.fulfill({ headers, json: data })
    if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, status: 204 })
    if (url.pathname.endsWith('/auth/me')) return json({ id: 'prueba-semanal', username: 'Prueba', permisos: { a: 'ADMINISTRADOR_FINCA', b: 'CONSULTA' } })
    if (url.pathname.endsWith('/auth/csrf')) return json({ token: 'prueba', headerName: 'X-CSRF-TOKEN' })
    if (url.pathname.endsWith('/auth/offline')) {
      const { generateKeyPairSync, sign } = await import('node:crypto')
      const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      const deviceId = new URLSearchParams(route.request().postData() ?? '').get('deviceId')
      const issuedAt = Date.now()
      const payload = Buffer.from(JSON.stringify({
        user: { id: 'prueba-semanal', username: 'Prueba', permisos: { a: 'ADMINISTRADOR_FINCA', b: 'CONSULTA' } },
        deviceId, issuedAt, expiresAt: issuedAt + 3600000,
      }))
      return json({ payload: payload.toString('base64url'),
        signature: sign('sha256', payload, { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
        publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') })
    }
    if (url.pathname.endsWith('/cosechas')) {
      const farm = url.searchParams.get('fincaId')
      const monday = url.searchParams.get('semana')
      consultations.push(farm + '|' + monday)
      return json({ items: monday !== '2026-11-16' ? [] : farm === 'a' ? central : [row('central-b', B, R2, 2000, 60000)] })
    }
    const items = url.pathname.endsWith('/fincas') ? [A, B] : url.pathname.endsWith('/contactos') ? [R1, R2]
      : url.searchParams.get('fincaId') === 'a' ? [{ ...lot, fincaId: 'a' }] : []
    return json({ items, page: 1, totalPages: 1 })
  })

  await page.goto(origin + '/semana-prueba')
  await page.evaluate(records => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('agrosync', 1)
    open.onupgradeneeded = () => {
      const db = open.result
      db.createObjectStore('catalogos')
      const store = db.createObjectStore('recolecciones', { keyPath: 'id' })
      db.createObjectStore('operacionesPendientes', { keyPath: 'operationId' })
      records.forEach(record => store.add(record))
    }
    open.onsuccess = () => { open.result.close(); resolve() }
    open.onerror = () => reject(open.error)
  }), local)
  await page.goto(origin)
  const consult = page.getByRole('combobox', { name: 'Finca de consulta' })
  await expect(consult.locator('option')).toHaveCount(2)
  await page.getByLabel('Semana de la fecha').fill('2026-11-19')
  const total = page.getByTestId('weekly-total')
  const table = page.getByRole('table')
  await expect(total).toHaveText(/4[.\s]?300,00 COP/)
  await expect(table.getByRole('row')).toHaveCount(4)
  await expect(table.getByText('Confirmado en SuiteCRM')).toHaveCount(2)
  await expect(table.getByText('Pendiente de sincronizar')).toHaveCount(1)
  const settlement = page.getByRole('region', { name: 'Liquidación semanal' })
  await expect(settlement.getByRole('listitem').filter({ hasText: R1.nombre })).toContainText(/2[.\s]?000,00/)
  await expect(settlement.getByRole('listitem').filter({ hasText: R2.nombre })).toContainText(/2[.\s]?300,00/)

  await page.getByRole('combobox', { name: 'Finca', exact: true }).selectOption('a')
  await page.getByRole('combobox', { name: 'Recolector', exact: true }).selectOption('r1')
  await expect(total).toHaveText(/4[.\s]?300,00 COP/)
  await expect(table.getByRole('row')).toHaveCount(4)
  await consult.selectOption('b')
  await expect(total).toHaveText(/1[.\s]?200,00 COP/)
  await expect(table.getByRole('row')).toHaveCount(2)
  await consult.selectOption('a')
  await page.getByLabel('Semana de la fecha').fill('2026-11-12')
  await expect(total).toHaveText(/400,00 COP/)
  await expect(table.getByRole('row')).toHaveCount(2)
  await page.getByLabel('Semana de la fecha').fill('2026-11-19')
  await expect(total).toHaveText(/4[.\s]?300,00 COP/)
  await page.getByRole('button', { name: 'Preparar dispositivo offline' }).click()
  await expect(page.getByText('Listo para trabajar sin conexión')).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByText(/Se muestra la última descarga/)).toBeVisible()
  await expect(total).toHaveText(/4[.\s]?300,00 COP/)
  await consult.selectOption('b')
  await expect(total).toHaveText(/1[.\s]?200,00 COP/)
  expect(consultations).toEqual(expect.arrayContaining(['a|2026-11-16', 'b|2026-11-16', 'a|2026-11-09']))
})

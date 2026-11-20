import { generateKeyPairSync, sign } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('envía otro guardado al terminar el que ya estaba en curso', async ({ page }) => {
  const origin = 'http://127.0.0.1:5173'
  const api = 'http://127.0.0.1:8081/api/v1'
  const farm = { id: 'finca', nombre: 'Finca ficticia' }
  const lot = { id: 'lote', fincaId: farm.id, nombre: 'Lote ficticio' }
  const supply = { id: 'insumo', nombre: 'Insumo ficticio', unidad: 'kg', saldo: '0', estado: 'activo' }
  const user = { id: 'prueba-cola', username: 'Prueba', permisos: { [farm.id]: 'ADMINISTRADOR_FINCA' } }
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const writes: { path: string; id: string }[] = []
  const records: Record<string, string>[] = []
  const movements: Record<string, string>[] = []
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })

  await page.route(`${api}/**`, async route => {
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'content-type,x-csrf-token', 'Access-Control-Allow-Methods': 'GET,POST' }
    const json = (data: unknown) => route.fulfill({ headers, json: data })
    const method = route.request().method()
    const path = new URL(route.request().url()).pathname.split('/').at(-1)
    if (method === 'OPTIONS') return route.fulfill({ headers, status: 204 })
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
    if (path === 'labores' && method === 'POST') {
      const draft = route.request().postDataJSON()
      writes.push({ path, id: draft.operationId })
      await gate
      const record = { ...draft, id: draft.operationId, version: 'a'.repeat(64), responsableId: null }
      records.push(record)
      return json({ operationId: draft.operationId, registro: record })
    }
    if (path === 'movimientos' && method === 'POST') {
      const { operationId, insumoId, tipo, cantidad, fecha } = route.request().postDataJSON()
      writes.push({ path, id: operationId })
      movements.push({ id: operationId, insumoId, tipo, cantidad, fecha })
      return json({ operationId, crmId: operationId })
    }
    if (path === 'inventario') return json({ insumos: [supply], movimientos: movements })
    if (path === 'labores') return json({ registros: records })
    if (path === 'fincas' && route.request().url().includes('/registros/')) return json({ registros: [] })
    return json({ items: path === 'fincas' ? [farm] : path === 'lotes' ? [lot] : [], page: 1, totalPages: 1 })
  })

  try {
    await page.goto(origin + '/?modulo=registros')
    await page.getByRole('combobox', { name: 'Tipo de registro' }).selectOption('labores')
    await page.getByRole('button', { name: 'Nuevo registro' }).click()
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Poda para la prueba')
    await page.getByRole('combobox', { name: 'Lote', exact: true }).selectOption(lot.id)
    await page.getByRole('combobox', { name: 'Labor', exact: true }).selectOption('poda')
    await page.getByRole('button', { name: 'Guardar registro' }).click()
    await expect.poll(() => writes.map(write => write.path)).toEqual(['labores'])

    await page.getByRole('button', { name: 'Inventario', exact: true }).click()
    await page.getByRole('textbox', { name: 'Cantidad', exact: true }).fill('2')
    await page.getByRole('button', { name: 'Guardar movimiento' }).click()
    const history = page.getByRole('region', { name: 'Historial', exact: true })
    await expect(history.getByText('Pendiente de sincronizar')).toBeVisible()
    expect(writes.map(write => write.path)).toEqual(['labores'])
    const nextQuantity = page.getByRole('textbox', { name: 'Cantidad', exact: true })
    await nextQuantity.fill('3')
    release()

    await expect(history.getByText('Confirmado en SuiteCRM')).toBeVisible()
    await expect(nextQuantity).toHaveValue('3')
    await page.getByRole('button', { name: 'Registros', exact: true }).click()
    await page.getByRole('combobox', { name: 'Tipo de registro' }).selectOption('labores')
    const confirmed = page.getByRole('listitem').filter({ hasText: 'Poda para la prueba' })
    await expect(confirmed).toContainText('Confirmado en SuiteCRM')
    expect(writes.map(write => write.path)).toEqual(['labores', 'movimientos'])
    expect(new Set(writes.map(write => write.id)).size).toBe(2)
  } finally {
    release()
  }
})

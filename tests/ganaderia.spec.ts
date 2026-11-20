import { chromium, expect, test, type BrowserContext } from '@playwright/test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const origin = 'http://127.0.0.1:5173'
const api = 'http://127.0.0.1:8081/api/v1'
const user = { id: 'prueba-ganadera', username: 'Prueba ganadera', permisos: { finca: 'ADMINISTRADOR_FINCA' } }
const motherId = '00000000-0000-4000-8000-000000000003'
const calfId = '00000000-0000-4000-8000-000000000002'
const eventId = '00000000-0000-4000-8000-000000000001'

test('Ganadería registra sin red, recupera referencias y reintenta en orden sin duplicados', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agrosync-ganado-'))
  const launch = () => chromium.launchPersistentContext(profile, {
    headless: true, executablePath: process.env.CHROME_PATH, locale: 'es-CO',
  })
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const writes = new Map<string, Record<string, string>>()
  const attempts: string[] = []
  let loseFirstReceipt = true
  const mock = (context: BrowserContext) => context.route(`${api}/**`, async route => {
    const url = new URL(route.request().url())
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'content-type,x-csrf-token', 'Access-Control-Allow-Methods': 'GET,POST' }
    const method = route.request().method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ headers, json: user })
    if (url.pathname.endsWith('/auth/csrf')) return route.fulfill({ headers, json: { token: 'prueba', headerName: 'X-CSRF-TOKEN' } })
    if (url.pathname.endsWith('/auth/offline')) {
      const deviceId = new URLSearchParams(route.request().postData() || '').get('deviceId')
      const issuedAt = Date.now()
      const payload = Buffer.from(JSON.stringify({ user, deviceId, issuedAt, expiresAt: issuedAt + 86_400_000 }))
      return route.fulfill({ headers, json: {
        payload: payload.toString('base64url'),
        signature: sign('sha256', payload, { key: keyPair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
        publicKey: keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      } })
    }
    if (url.pathname.endsWith('/bitacora')) return route.fulfill({ headers, json: { eventos: [], siguiente: null } })
    if (url.pathname.endsWith('/ganaderia')) return route.fulfill({ headers, json: { animales: [], eventos: [] } })
    if (url.pathname.includes('/ganaderia/') && method === 'POST') {
      const record: Record<string, string> = JSON.parse(route.request().postData() || '{}')
      const id = record.operationId
      attempts.push(id)
      const reference = record.animalId || record.madreId
      if (reference && !writes.has(reference)) return route.fulfill({ headers, status: 409, json: {} })
      const repeated = writes.has(id)
      if (!repeated) writes.set(id, record)
      if (loseFirstReceipt) {
        loseFirstReceipt = false
        return route.fulfill({ headers, status: 503, json: { message: 'Respuesta perdida para la prueba.' } })
      }
      return route.fulfill({ headers, status: repeated ? 200 : 201, json: { operationId: id, crmId: id } })
    }
    const items = url.pathname.endsWith('/fincas') ? [{ id: 'finca', nombre: 'Finca de prueba ganadera' }] : []
    return route.fulfill({ headers, json: { items, page: 1, totalPages: 1 } })
  })

  let context = await launch()
  try {
    await mock(context)
    let page = context.pages()[0]
    await page.goto(origin)
    await page.getByRole('button', { name: 'Ganadería', exact: true }).click()
    await page.getByRole('button', { name: 'Preparar Ganadería offline' }).click()
    await expect(page.getByText('Dispositivo preparado para trabajar sin conexión.')).toBeVisible()
    await context.setOffline(true)
    await expect(page.getByText('Sin conexión', { exact: true })).toBeVisible()
    await page.evaluate(ids => {
      let index = 0
      const original = crypto.randomUUID.bind(crypto)
      Object.defineProperty(crypto, 'randomUUID', { value: () => ids[index++] ?? original() })
    }, [motherId, calfId, eventId])

    async function register(code: string, name: string, mother?: string) {
      await page.getByLabel('Código', { exact: true }).fill(code)
      await page.getByLabel('Nombre del animal').fill(name)
      await page.getByRole('combobox', { name: 'Sexo' }).selectOption('hembra')
      if (mother) {
        await page.getByRole('checkbox', { name: 'Registrar nacimiento' }).check()
        await expect(page.getByLabel('Fecha de nacimiento')).toHaveJSProperty('required', true)
        await expect(page.getByRole('combobox', { name: 'Madre' })).toHaveJSProperty('required', true)
        const today = await page.evaluate(() => {
          const date = new Date()
          return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
            .map(part => String(part).padStart(2, '0')).join('-')
        })
        await page.getByLabel('Fecha de nacimiento').fill(today)
        await page.getByRole('combobox', { name: 'Madre' }).selectOption(mother)
      }
      await page.getByRole('button', { name: 'Guardar animal' }).click()
      await expect(page.getByRole('row', { name: new RegExp(name) }).first()).toBeVisible()
    }

    await register('PRUEBA-MADRE', 'Madre de prueba')
    await expect(page.getByText('Edad desconocida')).toBeVisible()
    await register('PRUEBA-CRIA', 'Cría de prueba', motherId)
    await page.getByRole('combobox', { name: 'Animal', exact: true }).selectOption(calfId)
    await page.getByLabel('Nombre del evento').fill('Revisión de prueba')
    await page.getByRole('combobox', { name: 'Tipo de evento' }).selectOption('revision')
    await page.getByRole('button', { name: 'Guardar evento' }).click()
    await expect(page.getByRole('row', { name: /Revisión de prueba/ })).toContainText('Cría de prueba')
    await expect(page.getByText('Pendiente de sincronizar', { exact: true })).toHaveCount(3)
    expect(attempts).toHaveLength(0)

    await context.close()
    context = await launch()
    await context.setOffline(true)
    page = context.pages()[0]
    await page.goto(origin + '/?modulo=ganaderia')
    await expect(page.getByText('Pendiente de sincronizar', { exact: true })).toHaveCount(3)
    await expect(page.getByRole('row', { name: /PRUEBA-CRIA/ })).toContainText('Madre de prueba')
    await expect(page.getByRole('row', { name: /PRUEBA-CRIA/ })).toContainText('Edad: 0 días')
    await expect(page.getByRole('row', { name: /Revisión de prueba/ })).toContainText('Cría de prueba')
    await mock(context)
    await context.setOffline(false)
    const sync = page.getByRole('button', { name: 'Sincronizar Ganadería' })
    await sync.click()
    await expect(page.getByRole('alert')).toContainText('Respuesta perdida')
    await page.getByRole('button', { name: 'Incidencias' }).click()
    await expect(page.getByRole('row', { name: /Respuesta perdida/ }).filter({ hasText: motherId })).toContainText(motherId)
    await page.getByRole('button', { name: 'Ganadería', exact: true }).click()
    await expect(page.getByText('Pendiente de sincronizar', { exact: true })).toHaveCount(3)
    await sync.click()
    await expect(page.getByText('Confirmado en SuiteCRM', { exact: true })).toHaveCount(3)
    expect(attempts).toEqual([motherId, motherId, calfId, eventId])
    expect(writes.size).toBe(3)
    expect(writes.get(calfId)?.madreId).toBe(motherId)
    expect(writes.get(calfId)?.registrarNacimiento).toBe(true)
    const exportFile = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar historial sanitario' }).click()
    const csv = await readFile(await (await exportFile).path(), 'utf8')
    expect(csv).toContain('"Revisión de prueba","Cría de prueba"')
    expect(writes.get(eventId)?.animalId).toBe(calfId)
    await page.getByRole('button', { name: 'Café', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Recolección de café' })).toBeVisible()
  } finally {
    await context.close()
    await rm(profile, { recursive: true, force: true })
  }
})

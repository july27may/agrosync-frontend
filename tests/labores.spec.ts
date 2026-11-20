import { expect, test } from '@playwright/test'

test('corrige una labor creada sin el responsable del borrador sin crear otra labor', async ({ page }) => {
  const origin = 'http://127.0.0.1:5173'
  const api = 'http://127.0.0.1:8081/api/v1'
  const farm = { id: 'finca', nombre: 'Finca ficticia' }
  const lot = { id: 'lote', fincaId: farm.id, nombre: 'Lote ficticio' }
  const contact = { id: 'contacto', nombre: 'Contacto ficticio' }
  const user = { id: 'prueba-labores', username: 'Prueba', permisos: { [farm.id]: 'ADMINISTRADOR_FINCA' } }
  const name = 'Poda ficticia'
  type Draft = { operationId: string; id?: string; version?: string; nombre: string; responsableId: string }
  type RecordData = { id: string; version: string; nombre: string; loteId: string; tipo: string; responsableId?: string }
  const writes: Draft[] = []
  let central: RecordData | undefined

  await page.route(`${api}/**`, route => {
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'content-type,x-csrf-token', 'Access-Control-Allow-Methods': 'GET,POST' }
    const json = (data: unknown) => route.fulfill({ headers, json: data })
    const method = route.request().method()
    const path = new URL(route.request().url()).pathname.split('/').at(-1)
    if (method === 'OPTIONS') return route.fulfill({ headers, status: 204 })
    if (path === 'me') return json(user)
    if (path === 'csrf') return json({ token: 'prueba', headerName: 'X-CSRF-TOKEN' })
    if (path === 'resoluciones') return json({})
    if (path === 'labores' && method === 'POST') {
      const draft: Draft = JSON.parse(route.request().postData() ?? '{}')
      writes.push(draft)
      if (!central) {
        // La API anterior aceptaba la creación y devolvía un acuse sin responsableId.
        central = { id: draft.operationId, version: 'a'.repeat(64), nombre: draft.nombre, loteId: lot.id, tipo: 'poda' }
      } else {
        expect(draft.id).toBe(central.id)
        expect(draft.version).toBe(central.version)
        expect(draft.operationId).not.toBe(central.id)
        central = { ...central, responsableId: draft.responsableId, version: 'b'.repeat(64) }
      }
      return json({ operationId: draft.operationId, registro: central })
    }
    if (path === 'labores') return json({ registros: central ? [central] : [] })
    if (path === 'fincas' && route.request().url().includes('/registros/')) return json({ registros: [] })
    const items = path === 'fincas' ? [farm] : path === 'lotes' ? [lot] : path === 'contactos' ? [contact] : []
    return json({ items, page: 1, totalPages: 1 })
  })

  await page.goto(origin + '/?modulo=registros')
  await page.getByRole('combobox', { name: 'Tipo de registro' }).selectOption('labores')
  await page.getByRole('button', { name: 'Nuevo registro' }).click()
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name)
  await page.getByRole('combobox', { name: 'Lote', exact: true }).selectOption(lot.id)
  await page.getByRole('combobox', { name: 'Labor', exact: true }).selectOption('poda')
  const responsible = page.getByRole('combobox', { name: 'Responsable de la labor' })
  await responsible.selectOption(contact.id)
  const save = page.getByRole('button', { name: 'Guardar registro' })
  await save.click()

  await expect(page.getByText('Conflicto', { exact: true })).toBeVisible()
  await expect(page.getByText('La labor ya existe en SuiteCRM. Revisa el responsable para corregirla.', { exact: false })).toBeVisible()
  await expect(page.getByText(/Versión confirmada:.*Sin responsable/)).toBeVisible()
  await expect(page.getByText(/Tu borrador:.*Contacto ficticio/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Revisar cambios' }).click()
  await expect(responsible).toHaveValue(contact.id)
  await save.click()
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toBeEnabled()
  const confirmed = page.getByRole('listitem').filter({ hasText: name })
  await expect(confirmed).toHaveCount(1)
  await expect(confirmed).toContainText('Confirmado en SuiteCRM')
  await expect(confirmed).toContainText(contact.nombre)
  expect(writes).toHaveLength(2)
  expect(writes[1].id).toBe(writes[0].operationId)
  expect(writes[1].responsableId).toBe(contact.id)
})

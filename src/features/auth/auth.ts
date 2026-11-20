import { apiUrl, request } from '../../shared/api'

export interface User {
  id: string
  username: string
  permisos: Record<string, 'ADMINISTRADOR_FINCA' | 'REGISTRADOR' | 'CONSULTA'>
  conflictos?: { id: string; nombre: string; roles: string[] }[]
}
interface Grant { user: User; deviceId: string; issuedAt: number; expiresAt: number }
interface SignedGrant { payload: string; signature: string; publicKey: string }
const grantKey = 'agrosync.authorization'
const deviceKey = 'agrosync.device'
const lockKey = 'agrosync.locked'

function device() {
  let id = localStorage.getItem(deviceKey)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(deviceKey, id)
  }
  return id
}

export async function serverUser(): Promise<User | undefined> {
  const response = await request('auth/me')
  if (response.status === 401) return undefined
  if (response.status === 403) throw new Error('La sesión existe, pero SuiteCRM denegó la consulta de tus permisos.')
  if (!response.ok) throw new Error('No se pudo consultar la autorización en SuiteCRM.')
  return response.json()
}

async function post(path: string, body?: URLSearchParams) {
  const response = await request('auth/csrf')
  if (!response.ok) throw new Error('No se pudo preparar la sesión.')
  const { token, headerName } = await response.json()
  return request(`auth/${path}`, { method: 'POST', headers: { [headerName]: token }, body })
}

async function closeServerSessions() {
  const response = await post('logout')
  const crmLogout = response.headers.get('X-AgroSync-Logout-Url')
  if (!response.ok || !crmLogout) throw new Error('No se pudo cerrar la sesión en el servidor.')

  // Same-site cookie credentials reach SuiteCRM even though its logout page has no CORS headers.
  await fetch(crmLogout, {
    mode: 'no-cors', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8000),
  }).catch(() => { throw new Error('No se pudo cerrar la sesión de SuiteCRM. Vuelve a intentar con conexión.') })
}

export async function beginLogin() {
  if (locked()) {
    await closeServerSessions()
    localStorage.removeItem(lockKey)
  }
  window.location.assign(apiUrl('auth/login'))
}

export async function logout(online: boolean) {
  localStorage.setItem(lockKey, '1')
  localStorage.removeItem(grantKey)
  if (online) await closeServerSessions()
}

export function locked() {
  return localStorage.getItem(lockKey) === '1'
}

export async function prepareGrant(owner: string) {
  if (!navigator.onLine || locked()) throw new Error('Conéctate e inicia sesión para preparar el dispositivo.')
  const response = await post('offline', new URLSearchParams({ deviceId: device() }))
  if (!response.ok) throw new Error('No se pudo autorizar este dispositivo.')
  const signed: SignedGrant = await response.json()
  const grant = await verify(signed)
  if (locked() || grant.user.id !== owner) throw new Error('La sesión cambió antes de preparar el dispositivo.')
  localStorage.setItem(grantKey, JSON.stringify(signed))
  return grant
}

function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
}

async function verify(signed: SignedGrant): Promise<Grant> {
  const data = decode(signed.payload)
  const key = await crypto.subtle.importKey('spki', decode(signed.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode(signed.signature), data)) {
    throw new Error('La autorización offline no es válida.')
  }
  const grant: Grant = JSON.parse(new TextDecoder().decode(data))
  const now = Date.now()
  if (grant.deviceId !== device() || !grant.user?.permisos || !Number.isSafeInteger(grant.expiresAt) || !Number.isSafeInteger(grant.issuedAt)
      || grant.expiresAt <= now || grant.issuedAt > now || grant.expiresAt <= grant.issuedAt) {
    throw new Error('La autorización offline venció o pertenece a otro dispositivo.')
  }
  return grant
}

export async function offlineGrant(): Promise<Grant | undefined> {
  const value = localStorage.getItem(grantKey)
  if (!value || locked()) return
  try { return await verify(JSON.parse(value)) } catch { return undefined }
}

export function discardGrant() { localStorage.removeItem(grantKey) }

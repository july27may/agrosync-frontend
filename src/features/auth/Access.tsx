import { useEffect, useState } from 'react'
import { App } from '../../app/App'
import { beginLogin, discardGrant, locked, logout, offlineGrant, serverUser, type User } from './auth'

type Session = { user: User; offline: boolean; expiresAt?: number; issuedAt?: number }

async function currentGrant(user: User) {
  const grant = await offlineGrant()
  if (!grant) return undefined
  const permissions = Object.entries(user.permisos)
  if (grant.user.id !== user.id || Object.keys(grant.user.permisos).length !== permissions.length
      || permissions.some(([farm, role]) => grant.user.permisos[farm] !== role)) {
    discardGrant()
    return undefined
  }
  return grant
}

export function Access() {
  const [session, setSession] = useState<Session>()
  const [checking, setChecking] = useState(true)
  const [authAction, setAuthAction] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const loginFailure = new URLSearchParams(window.location.search).get('login')
  const loginMessage = loginFailure === 'sesion'
    ? 'No se encontró la sesión de inicio. Abre AgroSync en 127.0.0.1 y vuelve a ingresar en esta pestaña.'
    : loginFailure === 'proveedor' ? 'No se pudo verificar la identidad con SuiteCRM.'
      : loginFailure === 'error' ? 'SuiteCRM no completó la autenticación. Vuelve a ingresar.' : ''
  const [error, setError] = useState(loginMessage)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let active = true
    let retry: number | undefined
    let requestNumber = 0
    async function restore() {
      const current = ++requestNumber
      const latest = () => active && current === requestNumber
      clearTimeout(retry)
      setOnline(navigator.onLine)
      try {
        if (locked()) {
          if (latest()) { setSession(undefined); setAvailable(false) }
          return
        }
        if (navigator.onLine) {
          const user = await serverUser()
          const grant = user ? await currentGrant(user) : undefined
          if (latest() && !locked()) {
            setError(user ? '' : loginMessage)
            setSession(user ? { user, offline: false, expiresAt: grant?.expiresAt, issuedAt: grant?.issuedAt } : undefined)
          }
        } else {
          const grant = await offlineGrant()
          if (latest() && !locked()) {
            setAvailable(Boolean(grant))
            setSession(grant ? { user: grant.user, offline: true, expiresAt: grant.expiresAt, issuedAt: grant.issuedAt } : undefined)
            if (!grant) setError('Este dispositivo necesita una autorización offline vigente. Tus registros pendientes se conservan.')
          }
        }
      } catch (failure) {
        const grant = await offlineGrant()
        if (latest() && !locked()) {
          setSession(grant ? { user: grant.user, offline: true, expiresAt: grant.expiresAt, issuedAt: grant.issuedAt } : undefined)
          setError(failure instanceof Error ? failure.message : 'No se pudo verificar la sesión.')
          if (navigator.onLine) retry = window.setTimeout(() => void restore(), 30000)
        }
      } finally { if (latest()) setChecking(false) }
    }
    void restore()
    const update = () => { void restore() }
    window.addEventListener('online', update)
    const changed = (event: StorageEvent) => {
      if (event.key === 'agrosync.locked' || (event.key === 'agrosync.authorization' && !navigator.onLine)) update()
    }
    window.addEventListener('offline', update)
    window.addEventListener('storage', changed)
    return () => {
      active = false
      clearTimeout(retry)
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.removeEventListener('storage', changed)
    }
  }, [])

  useEffect(() => {
    if (!session?.offline || !session.expiresAt) return
    const expire = () => {
      setSession(undefined)
      setAvailable(false)
      setError('La autorización offline venció. Tus registros pendientes se conservan.')
    }
    const expiry = session.expiresAt
    let timer: number
    function verify() {
      clearTimeout(timer)
      const remaining = expiry - Date.now()
      if (remaining <= 0) expire()
      else timer = window.setTimeout(verify, Math.min(remaining, 2_147_483_647))
    }
    verify()
    document.addEventListener('visibilitychange', verify)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', verify) }
  }, [session])

  if (session) return <App key={JSON.stringify([session.user.id, session.user.permisos])} user={session.user} offline={session.offline}
    expiresAt={session.expiresAt} issuedAt={session.issuedAt}
    onPrepared={({ expiresAt, issuedAt }) => setSession(current => current ? { ...current, expiresAt, issuedAt } : current)}
    refreshPermissions={async () => {
      const user = await serverUser()
      if (!user || user.id !== session.user.id || locked()) {
        throw new Error('La finca fue registrada. Inicia sesión para consultar los permisos actualizados.')
      }
      const grant = await currentGrant(user)
      setSession(current => current?.user.id === user.id && !locked()
        ? { ...current, user, expiresAt: grant?.expiresAt, issuedAt: grant?.issuedAt } : current)
    }}
    onSessionExpired={() => {
      setSession(undefined)
      setError('La sesión venció. Inicia sesión para enviar tus pendientes.')
    }}
    close={() => {
      setSession(undefined)
      setAvailable(false)
      setError('')
      setAuthAction(true)
      void logout(navigator.onLine).catch(failure => setError(failure.message)).finally(() => setAuthAction(false))
    }}
    authorize={async (farm, onlyAdmin = false) => {
      const user = navigator.onLine && !session.offline ? await serverUser() : (await offlineGrant())?.user
      if (!user || user.id !== session.user.id) {
        setSession(undefined)
        setError('Se requiere una autorización vigente. Tus registros pendientes se conservan.')
        return false
      }
      return user.permisos[farm] === 'ADMINISTRADOR_FINCA' || (!onlyAdmin && user.permisos[farm] === 'REGISTRADOR')
    }} />

  return <main className="login-shell">
    <section className="card login-card">
      <p className="eyebrow">AGROSYNC</p>
      <h1>Iniciar sesión</h1>
      <button type="button" className="primary" onClick={() => {
        setAuthAction(true)
        setError('')
        void beginLogin().catch(failure => {
          setError(failure.message)
          setAuthAction(false)
        })
      }} disabled={checking || authAction || !online}>
        {checking ? 'Verificando…' : 'Ingresar con SuiteCRM'}
      </button>
      {!online && available && <button className="secondary" onClick={() => {
        void offlineGrant().then(grant => { if (grant) setSession({ user: grant.user, offline: true, expiresAt: grant.expiresAt, issuedAt: grant.issuedAt }) })
      }}>Continuar sin conexión</button>}
      {error && <p className="notice error" role="alert">{error}</p>}
    </section>
  </main>
}

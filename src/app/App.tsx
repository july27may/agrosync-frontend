import { synchronize } from '../features/sincronizacion/queue'
import { SYNC_REQUEST } from '../features/sincronizacion/requests'
import { prepareGrant, type User } from "../features/auth/auth"
import { useEffect, useRef, useState } from 'react'
import { loadCatalogs, refreshCatalogs, type Catalogs } from '../features/catalogos/catalogs'
import { HarvestForm } from '../features/recolecciones/HarvestForm'
import { listHarvests, type Harvest } from '../features/recolecciones/harvests'
import { WeeklyHarvests } from '../features/liquidacion/WeeklyHarvests'
import { Incidencias } from '../features/incidencias/Incidencias'
import { Registros } from '../features/registros/Registros'
import { Inventario } from '../features/inventario/Inventario'
import { Ganaderia } from '../features/ganaderia/Ganaderia'
import { useOfflineStatus } from '../shared/offline'

const moduleNames = { cafe: 'Café', ganaderia: 'Ganadería', inventario: 'Inventario', registros: 'Registros', incidencias: 'Incidencias' }

export function App({ user, offline, close, authorize, expiresAt: prepared, issuedAt, onPrepared, onSessionExpired, refreshPermissions }: {
  user: User; offline: boolean; close: () => void; authorize: (farm: string, onlyAdmin?: boolean) => Promise<boolean>; expiresAt?: number; issuedAt?: number
  onPrepared: (grant: { expiresAt: number; issuedAt: number }) => void; onSessionExpired: () => void
  refreshPermissions: () => Promise<void>
}) {
  const { online, ready, failed } = useOfflineStatus()
  const [module, setModule] = useState(new URLSearchParams(location.search).get('modulo') ?? 'cafe')
  function navigate(value: string) {
    const url = new URL(location.href)
    url.searchParams.delete('login')
    if (value !== 'cafe') url.searchParams.set('modulo', value)
    else url.searchParams.delete('modulo')
    window.history.replaceState(null, '', url)
    setModule(value)
  }
  const [catalogs, setCatalogs] = useState<Catalogs>()
  const [records, setRecords] = useState<Harvest[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncNotice, setSyncNotice] = useState('')
  const [syncError, setSyncError] = useState('')
  const [weeklyFarm, setWeeklyFarm] = useState(() => localStorage.getItem(`agrosync.weeklyFarm:${user.id}`) ?? '')
  const [weekRevision, setWeekRevision] = useState(0)
  function chooseWeeklyFarm(farm: string) {
    setWeeklyFarm(farm)
    localStorage.setItem(`agrosync.weeklyFarm:${user.id}`, farm)
  }
  const syncingRef = useRef(false)
  const retrySync = useRef(false)
  const queuedSync = useRef<boolean | undefined>(undefined)
  const refreshingRef = useRef(false)

  async function prepare(manual = false) {
    if (offline || !navigator.onLine || refreshingRef.current || !Object.keys(user.permisos).length) return
    refreshingRef.current = true
    setRefreshing(true)
    setError('')
    try {
      setCatalogs(await refreshCatalogs(user.id))
      if (ready && navigator.onLine && (manual || !prepared || prepared <= Date.now())) {
        onPrepared(await prepareGrant(user.id))
      }
      if (manual) setWeekRevision(previous => previous + 1)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo preparar el dispositivo.')
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }

  useEffect(() => {
    let active = true
    void Promise.all([loadCatalogs(user.id), listHarvests(user.id)]).then(([stored, history]) => {
      if (active) {
        setCatalogs(stored)
        setRecords(history)
      }
    }).catch(() => { if (active) setError('No se pudo abrir el almacenamiento de este navegador.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user.id])

  useEffect(() => {
    if (!loading && online && !offline && (ready || failed)) void prepare()
  }, [loading, online, offline, ready, failed])

  const allowed = new Set(Object.keys(user.permisos))
  const scoped = catalogs && { ...catalogs, fincas: catalogs.fincas.filter(f => allowed.has(f.id)),
    lotes: catalogs.lotes.filter(lot => allowed.has(lot.fincaId)),
    contactos: allowed.size ? catalogs.contactos : [] }
  const canCapture = (farm: string) => user.permisos[farm] === 'REGISTRADOR'
    || user.permisos[farm] === 'ADMINISTRADOR_FINCA'
  async function sync(manual = false) {
    if (offline || !navigator.onLine) return
    if (syncingRef.current) {
      queuedSync.current = manual || queuedSync.current === true
      return
    }
    syncingRef.current = true
    retrySync.current = false
    setSyncing(true)
    setSyncError('')
    setSyncNotice('')
    let expired = false
    try {
      let next: boolean | undefined = manual
      let confirmed = 0
      let remaining = 0
      let issue: string | undefined
      while (next !== undefined && navigator.onLine) {
        queuedSync.current = undefined
        const result = await synchronize(user.id, next)
        if (!result) {
          retrySync.current = true
          break
        }
        if (result.expired) {
          expired = true
          onSessionExpired()
          return
        }
        retrySync.current = Boolean(result.retry)
        confirmed += result.confirmed
        remaining = result.remaining
        issue = result.issue ?? issue
        next = queuedSync.current
      }
      if (confirmed) {
        setSyncNotice(`${confirmed} ${confirmed === 1 ? 'operación confirmada' : 'operaciones confirmadas'} en SuiteCRM.`)
        setCatalogs(await refreshCatalogs(user.id).catch(() => loadCatalogs(user.id)))
      }
      if (remaining) {
        setSyncError(issue ?? 'Quedan operaciones por enviar o revisar. Tus registros siguen guardados.')
      }
    } catch (failure) {
      setSyncError(failure instanceof Error ? failure.message : 'No se pudo sincronizar. Se conservan los pendientes.')
    } finally {
      try { setRecords(await listHarvests(user.id)) }
      catch { setSyncError('No se pudo releer el historial local.') }
      setWeekRevision(previous => previous + 1)
      const next = queuedSync.current
      queuedSync.current = undefined
      syncingRef.current = false
      setSyncing(false)
      if (!expired && next !== undefined) void sync(next)
    }
  }

  useEffect(() => {
    if (offline || !online) return
    const send = () => void sync()
    send()
    const timer = window.setInterval(() => { if (retrySync.current) send() }, 30000)
    window.addEventListener(SYNC_REQUEST, send)
    return () => {
      clearInterval(timer)
      window.removeEventListener(SYNC_REQUEST, send)
    }
  }, [user.id, offline, online])

  const captureCatalogs = scoped && { ...scoped, fincas: scoped.fincas.filter(f => canCapture(f.id)) }
  const history = records.filter(record => allowed.has(record.finca.id))
  const weeklyFarms = [...new Map([
    ...history.map(record => [record.finca.id, record.finca] as const),
    ...(scoped?.fincas ?? []).map(farm => [farm.id, farm] as const),
  ]).values()]
  const preparedDevice = Boolean(ready && prepared && prepared > Date.now() && scoped?.fincas.length)
  const preparedAt = Math.max(issuedAt ?? 0, catalogs ? Date.parse(catalogs.updatedAt) : 0)
  const label = loading ? 'Abriendo almacenamiento…' : refreshing ? 'Preparando datos offline…'
    : preparedDevice ? 'Listo para trabajar sin conexión'
      : failed ? 'Caché de la aplicación no disponible' : 'Preparación sin conexión pendiente'

  return <>
    <header className="top"><div className="shell top-inner">
      <a className="brand" href="/">Agro<span>Sync</span></a>
      <nav className="module-nav" aria-label="Módulos">
        {Object.entries(moduleNames).map(([id, name]) => <button key={id} type="button"
          onClick={() => navigate(id)} aria-current={module === id ? 'page' : undefined}>{name}</button>)}
      </nav>
      <div className="session-tools"><span>{user.username}</span>
      <span className={`tag ${online && !offline ? 'online' : 'pending'}`}><i />{online && !offline ? 'Con conexión' : 'Sin conexión'}</span>
      <button className="secondary" onClick={close}>Cerrar sesión</button></div>
    </div></header>
    <div className="shell">
      <section className="catalog-bar device-bar" aria-label="Preparación y sincronización del dispositivo">
        <div>
          <strong role="status">{label}</strong>
          {preparedDevice && preparedAt > 0 && <p>Listo desde {new Date(preparedAt).toLocaleString('es-CO')}.</p>}
          {prepared && <p>Autorización offline hasta {new Date(prepared).toLocaleString('es-CO')}.</p>}
          {scoped && <p>{scoped.fincas.length} fincas · {scoped.lotes.length} lotes · {scoped.contactos.length} contactos</p>}
        </div>
        <div className="session-tools">
          <button className="secondary" onClick={() => void prepare(true)}
            disabled={offline || !online || loading || refreshing || !allowed.size}>Actualizar datos offline</button>
          <button className="secondary" disabled={!online || offline || syncing} onClick={() => void sync(true)}>
            {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </div>
      </section>
      {(error || syncError) && <p className="notice error" role="alert">{error || syncError}</p>}
      {syncNotice && <p className="notice success" role="status">{syncNotice}</p>}
    </div>
    {module === 'incidencias' ? <Incidencias user={user} farms={scoped?.fincas ?? []} offline={offline || !online} />
      : module === 'registros' ? <Registros user={user} catalogs={scoped} offline={offline || !online}
        authorize={authorize} revision={weekRevision} afterCreate={async () => {
          setCatalogs(await refreshCatalogs(user.id))
          await refreshPermissions()
        }} />
      : module === 'inventario' ? <Inventario user={user} farms={scoped?.fincas ?? []}
        offline={offline || !online} expiresAt={prepared} authorize={authorize} revision={weekRevision} />
      : module === 'ganaderia' ? <Ganaderia user={user} offline={offline || !online} authorize={authorize}
        revision={weekRevision} /> : <main className="shell">
      <div className="intro"><div>
        <p className="eyebrow">CAFÉ / CAPTURA EN CAMPO</p>
        <h1>Recolección de café</h1>
        <p>Registra la jornada y consulta la liquidación semanal por recolector.</p>
      </div></div>
      {!!scoped?.fincas.length && <p>{scoped.fincas.map(farm => {
        const roles = { ADMINISTRADOR_FINCA: 'Administrador de finca', REGISTRADOR: 'Registrador', CONSULTA: 'Consulta' }
        return `${farm.nombre} · ${roles[user.permisos[farm.id]]}`
      }).join(' / ')}</p>}
      {user.conflictos?.map(conflict => <p key={conflict.id} className="notice error" role="alert">
        {conflict.nombre}: perfiles incompatibles ({conflict.roles.map(role => role.replaceAll('_', ' ')).join(', ')}).
        Corrige la asignación en SuiteCRM.
      </p>)}
      {!allowed.size && !user.conflictos?.length && <p className="notice error" role="status">
        Sesión iniciada. Tu cuenta no tiene fincas asignadas en SuiteCRM.
      </p>}
      <div className="grid">
        {!Object.keys(user.permisos).some(canCapture) ? <section className="card"><h2>Acceso de consulta</h2><p>Puedes consultar las recolecciones de tus fincas.</p></section> :
        <HarvestForm onFarmChange={chooseWeeklyFarm} catalogs={captureCatalogs} owner={user.id} authorize={authorize} onSave={record => {
          setRecords(previous => [record, ...previous].sort((a, b) =>
            b.fecha.localeCompare(a.fecha) || b.createdAt.localeCompare(a.createdAt)))
        }} />}
        <WeeklyHarvests owner={user.id} farms={weeklyFarms} selected={weeklyFarm} select={chooseWeeklyFarm}
          records={history} offline={offline || !online} revision={weekRevision} />
      </div>
    </main>}
  </>
}

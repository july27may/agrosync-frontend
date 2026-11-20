import { prepareGrant, type User } from "../features/auth/auth"
import { useEffect, useRef, useState } from 'react'
import { loadCatalogs, refreshCatalogs, type Catalogs } from '../features/catalogos/catalogs'
import { HarvestForm } from '../features/recolecciones/HarvestForm'
import { syncHarvests } from '../features/recolecciones/sync'
import { listHarvests, type Harvest } from '../features/recolecciones/harvests'
import { WeeklyHarvests } from '../features/liquidacion/WeeklyHarvests'
import { Incidencias } from '../features/incidencias/Incidencias'
import { Registros } from '../features/registros/Registros'
import { Inventario } from '../features/inventario/Inventario'
import { Ganaderia } from '../features/ganaderia/Ganaderia'
import { useOfflineStatus } from '../shared/offline'

const moduleNames = { cafe: 'Café', ganaderia: 'Ganadería', inventario: 'Inventario', registros: 'Registros', incidencias: 'Incidencias' }

export function App({ user, offline, close, authorize, expiresAt: prepared, onPrepared }: {
  user: User; offline: boolean; close: () => void; authorize: (farm: string, onlyAdmin?: boolean) => Promise<boolean>; expiresAt?: number; onPrepared: (expiry: number) => void
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
  const [weeklyFarm, setWeeklyFarm] = useState(() => localStorage.getItem(`agrosync.weeklyFarm:${user.id}`) ?? '')
  const [weekRevision, setWeekRevision] = useState(0)
  function chooseWeeklyFarm(farm: string) {
    setWeeklyFarm(farm)
    localStorage.setItem(`agrosync.weeklyFarm:${user.id}`, farm)
  }
  const syncingRef = useRef(false)
  const refreshingRef = useRef(false)

  async function refresh() {
    if (offline) return
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    setError('')
    try {
      setCatalogs(await refreshCatalogs(user.id))
    } catch (failure) {
      setError(failure instanceof Error && failure.message.includes('catálogo')
        ? failure.message : 'La descarga falló. Comprueba la conexión con el backend y vuelve a intentar.')
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void Promise.all([loadCatalogs(user.id), listHarvests(user.id)]).then(([stored, history]) => {
      setCatalogs(stored)
      setRecords(history)
      if (!stored && !offline && navigator.onLine) void refresh()
    }).catch(() => setError('No se pudo abrir el almacenamiento de este navegador.'))
      .finally(() => setLoading(false))
  }, [])

  async function prepare() {
    setError('')
    try {
      onPrepared((await prepareGrant()).expiresAt)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo autorizar el dispositivo.')
    }
  }

  const allowed = new Set(Object.keys(user.permisos))
  const scoped = catalogs && { ...catalogs, fincas: catalogs.fincas.filter(f => allowed.has(f.id)),
    lotes: catalogs.lotes.filter(lot => allowed.has(lot.fincaId)),
    contactos: allowed.size ? catalogs.contactos : [] }
  const canCapture = (farm: string) => user.permisos[farm] === 'REGISTRADOR'
    || user.permisos[farm] === 'ADMINISTRADOR_FINCA'
  async function sync() {
    if (syncingRef.current || offline || !navigator.onLine) return
    syncingRef.current = true
    setSyncing(true)
    setError('')
    setSyncNotice('')
    try {
      const confirmed = await syncHarvests(user.id, canCapture)
      setSyncNotice(`${confirmed} ${confirmed === 1 ? 'recolección confirmada' : 'recolecciones confirmadas'} en SuiteCRM.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo sincronizar. Se conservan los pendientes.')
    } finally {
      try { setRecords(await listHarvests(user.id)) }
      catch { setError('No se pudo releer el historial local.') }
      setWeekRevision(previous => previous + 1)
      syncingRef.current = false
      setSyncing(false)
    }
  }

  const captureCatalogs = scoped && { ...scoped, fincas: scoped.fincas.filter(f => canCapture(f.id)) }
  const history = records.filter(record => allowed.has(record.finca.id))
  const weeklyFarms = [...new Map([
    ...history.map(record => [record.finca.id, record.finca] as const),
    ...(scoped?.fincas ?? []).map(farm => [farm.id, farm] as const),
  ]).values()]
  const pending = history.filter(record => !record.crmId && canCapture(record.finca.id)).length
  const available = Boolean(ready && prepared && prepared > Date.now() && scoped?.lotes.length && scoped.contactos.length)
  const label = loading ? 'Abriendo almacenamiento…' : available ? 'Listo para trabajar sin conexión'
    : failed ? 'Caché de la aplicación no disponible' : ready && catalogs
      ? 'Catálogos descargados · faltan lotes o contactos' : 'Preparación sin conexión pendiente'

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
    {module === 'incidencias' ? <Incidencias user={user} /> : module === 'registros' ? <Registros user={user} catalogs={scoped} offline={offline || !online}
      ready={ready} prepare={prepare} authorize={authorize} afterSync={refresh} /> : module === 'inventario' ? <Inventario user={user} farms={scoped?.fincas ?? []}
      offline={offline || !online} ready={ready} expiresAt={prepared} prepare={prepare} authorize={authorize} /> : module === 'ganaderia' ? <Ganaderia user={user} offline={offline || !online} authorize={authorize}
      ready={ready} expiresAt={prepared} onPrepared={onPrepared} /> : <main className="shell">
      <div className="intro"><div>
        <p className="eyebrow">CAFÉ / CAPTURA EN CAMPO</p>
        <h1>Recolección de café</h1>
        <p>Registra la jornada y consulta la liquidación semanal por recolector.</p>
      </div></div>
      <section className="catalog-bar" aria-label="Estado de los catálogos">
        <div><strong role="status">{label}</strong>
          <p>{scoped ? `${scoped.fincas.length} fincas · ${scoped.lotes.length} lotes · ${scoped.contactos.length} contactos · Actualizado ${new Date(scoped.updatedAt).toLocaleString('es-CO')}`
            : 'Descarga los catálogos antes de salir a campo.'}</p>
        </div>
        {scoped?.fincas.length ? <p>{scoped.fincas.map(farm => {
          const roles = { ADMINISTRADOR_FINCA: 'Administrador de finca', REGISTRADOR: 'Registrador', CONSULTA: 'Consulta' }
          return `${farm.nombre} · ${roles[user.permisos[farm.id]]}`
        }).join(' / ')}</p> : null}
        {prepared && <p>Autorización offline hasta {new Date(prepared).toLocaleString('es-CO')}.</p>}
        <div className="session-tools">
        {!offline && <button className="secondary" onClick={() => void prepare()} disabled={!online || !ready || !scoped || !allowed.size}>Preparar dispositivo offline</button>}
        <button className="secondary" onClick={() => void refresh()} disabled={offline || !online || loading || refreshing}>
          {refreshing ? 'Descargando…' : 'Actualizar catálogos'}
        </button></div>
      </section>
      {user.conflictos?.map(conflict => <p key={conflict.id} className="notice error" role="alert">
        {conflict.nombre}: perfiles incompatibles ({conflict.roles.map(role => role.replaceAll('_', ' ')).join(', ')}).
        Corrige la asignación en SuiteCRM.
      </p>)}
      {!allowed.size && !user.conflictos?.length && <p className="notice error" role="status">
        Sesión iniciada. Tu cuenta no tiene fincas asignadas en SuiteCRM.
      </p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="grid">
        {!Object.keys(user.permisos).some(canCapture) ? <section className="card"><h2>Acceso de consulta</h2><p>Puedes consultar las recolecciones de tus fincas.</p></section> :
        <HarvestForm onFarmChange={chooseWeeklyFarm} catalogs={captureCatalogs} owner={user.id} authorize={authorize} onSave={record => {
          setRecords(previous => [record, ...previous].sort((a, b) =>
            b.fecha.localeCompare(a.fecha) || b.createdAt.localeCompare(a.createdAt)))
        }} />}
        <WeeklyHarvests owner={user.id} farms={weeklyFarms} selected={weeklyFarm} select={chooseWeeklyFarm}
          records={history} offline={offline || !online} revision={weekRevision} />
      </div>
      {pending > 0 && <section className="catalog-bar" aria-label="Sincronización de recolecciones">
        <p>{pending} {pending === 1 ? 'recolección pendiente' : 'recolecciones pendientes'}</p>
        <button className="secondary" disabled={!online || offline || syncing} onClick={() => void sync()}>
          {syncing ? 'Sincronizando…' : 'Sincronizar recolecciones'}
        </button>
      </section>}
      {syncNotice && <p className="notice success" role="status">{syncNotice}</p>}
    </main>}
  </>
}

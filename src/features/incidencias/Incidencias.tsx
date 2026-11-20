import { useEffect, useState, type FormEvent } from 'react'
import { PaginatedTable } from '../../shared/PaginatedTable'
import type { User } from '../auth/auth'
import type { CatalogEntry } from '../catalogos/catalogs'
import { readCentralHistory, readIssues, type AuditEvent } from './incidents'

const labels: Record<string, string> = {
  inventario: 'Inventario', registro: 'Registros', recoleccion: 'Café', animal: 'Animales', 'evento-sanitario': 'Eventos sanitarios',
  cosechas: 'Café', 'inventario/movimientos': 'Inventario', 'registros/fincas': 'Fincas', 'registros/fincas/alta': 'Alta de finca',
  'registros/lotes': 'Lotes', 'registros/labores': 'Labores', 'registros/insumos': 'Insumos', 'registros/cosechas': 'Corrección de Café',
  'ganaderia/animales': 'Animales', 'ganaderia/eventos': 'Eventos sanitarios',
  'registros/animales': 'Corrección de animales', 'registros/eventos': 'Corrección sanitaria',
}
const eventNames: Record<string, [string, string]> = {
  INTENTO: ['Intento', 'neutral'], CONFIRMADO: ['Confirmado', 'online'], ERROR: ['Error', 'error'],
  CONFLICTO: ['Conflicto', 'pending'], RESOLUCION: ['Resolución', 'online'],
}
const causes: Record<string, string> = {
  VERSION_INCOMPATIBLE: 'La versión central cambió.',
  SALDO_INSUFICIENTE: 'El saldo confirmado no cubría la salida.',
  CONSERVAR_CENTRAL: 'Se conservó la versión central.',
  DESCARTAR_PENDIENTE: 'Se descartó el pendiente.',
  PROPONER_REVISION: 'Se preparó una corrección para volver a sincronizar.',
  CRM_NO_DISPONIBLE: 'SuiteCRM no estaba disponible.',
  CRM_TIEMPO_AGOTADO: 'Se agotó el tiempo de espera.',
  CODIGO_DUPLICADO: 'El código ya estaba en uso.',
  OPERACION_REUTILIZADA: 'El identificador correspondía a otro contenido.',
  ERROR_ENVIO: 'El envío no se pudo confirmar.',
}
const timeFormat = new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'medium' })

export function Incidencias({ user, farms, offline }: { user: User; farms: CatalogEntry[]; offline: boolean }) {
  const [issues, setIssues] = useState<Awaited<ReturnType<typeof readIssues>>>([])
  const [failed, setFailed] = useState(false)
  const [selected, select] = useState('')
  const allowed = Object.keys(user.permisos)
  const farm = allowed.includes(selected) ? selected : allowed[0]
  const [filter, setFilter] = useState('')
  const [operation, setOperation] = useState('')
  const [review, refresh] = useState(0)
  const [central, setCentral] = useState<{ key: string; events: AuditEvent[]; next?: string | null }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const key = `${user.id}:${farm}:${operation}`
  const visible = !offline && central?.key === key ? central : undefined

  useEffect(() => {
    let active = true
    void readIssues(user.id, Object.keys(user.permisos))
      .then(rows => { if (active) setIssues(rows) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [user])

  useEffect(() => {
    let active = true
    setCentral(undefined)
    setError('')
    setBusy(false)
    if (!farm || offline) return
    void readCentralHistory(farm, undefined, operation).then(page => {
      if (active) setCentral({ key, events: page.eventos, next: page.siguiente })
    }).catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [farm, offline, operation, key, review])

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setOperation(filter.trim().toLowerCase())
    refresh(previous => previous + 1)
  }

  async function loadMore() {
    if (!visible?.next || !farm || busy) return
    setBusy(true)
    setError('')
    try {
      const page = await readCentralHistory(farm, visible.next, operation)
      setCentral(current => current?.key === key
        ? { key, events: [...current.events, ...page.eventos], next: page.siguiente } : current)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'La bitácora no se pudo cargar.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="shell">
    <div className="intro"><h1>Incidencias de sincronización</h1></div>
    <div className="module-stack">
      <section className="card" aria-labelledby="central-audit">
        <header className="card-heading"><h2 id="central-audit">Bitácora central</h2></header>
        <form className="module-toolbar" onSubmit={search}>
          <div className="fields">
            <label>Finca de la bitácora<select value={farm ?? ''} onChange={event => select(event.target.value)} disabled={!allowed.length}>
              {!farm && <option value="">Sin fincas autorizadas</option>}
              {allowed.map(id => <option key={id} value={id}>{farms.find(entry => entry.id === id)?.nombre ?? id}</option>)}
            </select></label>
            <label>Identificador de operación<input value={filter} maxLength={36}
              pattern="[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}"
              onChange={event => setFilter(event.target.value)} /></label>
          </div>
          <div className="action-group"><button className="secondary" disabled={offline || !farm}>Consultar bitácora</button></div>
        </form>
        {offline && <p className="empty">Conéctate para consultar la bitácora central.</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        {!offline && farm && !visible && !error && <p className="empty" role="status">Cargando bitácora…</p>}
        {visible && <PaginatedTable label="bitácora central" scope={key} rows={visible.events}
          columns={['Fecha', 'Usuario', 'Módulo', 'Operación', 'Estado', 'Causa']}
          empty={<p className="empty">No hay eventos para esta consulta.</p>}>
          {page => page.map(row => {
            const [state, color] = eventNames[row.evento] ?? [row.evento, 'neutral']
            return <tr key={row.id}><td>{timeFormat.format(new Date(row.fecha))}</td><td>{row.usuario}</td>
              <td>{labels[row.modulo] ?? row.modulo}</td><td><code>{row.operationId}</code>
                {row.relatedOperationId && <small>Corrección: {row.relatedOperationId}</small>}</td>
              <td><span className={`tag ${color}`}>{state}</span></td>
              <td className="table-detail">{row.causa ? causes[row.causa] ?? row.causa : '—'}</td></tr>
          })}
        </PaginatedTable>}
        {!!visible?.next && <button className="secondary" type="button" disabled={busy} onClick={() => void loadMore()}>Ver anteriores</button>}
      </section>
      <section className="card" aria-labelledby="local-issues">
        <header className="card-heading"><h2 id="local-issues">Incidencias de este dispositivo</h2></header>
        {failed ? <p className="notice error" role="alert">No fue posible abrir las incidencias locales.</p> :
          <PaginatedTable label="incidencias locales" scope={user.id} rows={issues}
            columns={['Módulo', 'Identificador de operación', 'Estado', 'Causa']}
            empty={<p className="empty">No hay incidencias guardadas en este dispositivo.</p>}>
            {page => page.map(op => <tr key={op.operationId}><td>{labels[op.entity]}</td><td><code>{op.operationId}</code></td>
              <td><span className={`tag ${op.state === 'confirmed' ? 'online'
                : op.superseded || op.discarded ? 'neutral' : op.conflict ? 'pending' : 'error'}`}>
                {op.state === 'confirmed' ? 'Confirmado después de reintento'
                  : op.superseded || op.discarded ? 'Revisado' : op.conflict ? 'Conflicto' : 'Error pendiente'}
              </span></td><td className="table-detail">{op.issue}</td></tr>)}
          </PaginatedTable>}
      </section>
    </div>
  </main>
}

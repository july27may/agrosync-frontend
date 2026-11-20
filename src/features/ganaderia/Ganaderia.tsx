import { useEffect, useRef, useState, type FormEvent } from 'react'
import { prepareGrant, type User } from '../auth/auth'
import { downloadCsv } from '../../shared/csv'
import { localDate, labelDate } from '../../shared/format'
import { age } from './edad'
import { EMPTY, fetchSnapshot, readSnapshot, saveAnimal, saveEvent, syncLivestock } from './data'

const SEX = { hembra: 'Hembra', macho: 'Macho' }
const CATEGORY = { ternero: 'Ternero', ternera: 'Ternera', novillo: 'Novillo', novilla: 'Novilla', vaca: 'Vaca', toro: 'Toro' }
const STATUS = { activo: 'Activo', vendido: 'Vendido', fallecido: 'Fallecido', inactivo: 'Inactivo' }
const EVENT = { vacunacion: 'Vacunación', tratamiento: 'Tratamiento', revision: 'Revisión', otro: 'Otro' }
const choices = (values: Record<string, string>) => Object.entries(values).map(([value, label]) =>
  <option key={value} value={value}>{label}</option>)
const label = (values: Record<string, string>, value: string | null) => value ? values[value] ?? value : '—'

function State({ crmId }: { crmId?: string }) {
  return <span className={`tag ${crmId ? 'online' : 'pending'}`}>
    {crmId ? 'Confirmado en SuiteCRM' : 'Pendiente de sincronizar'}
  </span>
}

export function Ganaderia({ user, offline, authorize, ready, expiresAt, onPrepared }: {
  ready: boolean; expiresAt?: number; onPrepared: (expiry: number) => void;
  user: User; offline: boolean; authorize: (farm: string, onlyAdmin?: boolean) => Promise<boolean>
}) {
  const [data, setData] = useState(EMPTY)
  const [selectedFarm, setSelectedFarm] = useState('')
  const [birth, setBirth] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  const today = localDate()

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try { await action() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'La operación no se completó; se conservan los datos locales.') }
    finally {
      try { setData(await readSnapshot(user.id)) }
      catch { setError('No se pudo abrir el almacenamiento ganadero.') }
      setBusy(false)
      inFlight.current = false
    }
  }

  useEffect(() => {
    void run(async () => {
      const stored = await readSnapshot(user.id)
      setData(stored)
      if (navigator.onLine && !offline) await fetchSnapshot(user.id)
    })
  }, [user.id, offline])

  const farms = data.fincas.filter(farm => Object.hasOwn(user.permisos, farm.id))
  const farmId = farms.find(farm => farm.id === selectedFarm)?.id ?? farms[0]?.id ?? ''
  const role = user.permisos[farmId]
  const canCreateAnimal = role === 'ADMINISTRADOR_FINCA'
  const canCreateEvent = canCreateAnimal || role === 'REGISTRADOR'
  const animals = data.animales.filter(record => record.fincaId === farmId)
  const events = data.eventos.filter(record => record.fincaId === farmId)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
  const names = new Map(animals.map(animal => [animal.id, animal.nombre]))
  const contactNames = new Map(data.contactos.map(contact => [contact.id, contact.nombre]))
  const pending = [...animals, ...events].filter(record => !record.crmId).length

  function capture(kind: 'animal' | 'evento', event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const text = (key: string) => String(fields.get(key) ?? '').trim()
    const optional = (key: string) => text(key) || null
    void run(async () => {
      const animal = kind === 'animal'
      if (!farmId || !(animal ? canCreateAnimal : canCreateEvent) || !await authorize(farmId, animal)) {
        throw new Error('El perfil vigente no permite registrar en esta finca.')
      }
      if (!text('nombre')) throw new Error('Escribe un nombre válido.')
      if (animal) {
        const codigo = text('codigo')
        const madreId = optional('madre')
        if (birth && (!text('nacimiento') || !madreId)) throw new Error('Indica la fecha y la madre del nacimiento.')
        if (!codigo) throw new Error('Escribe un código válido.')
        if (animals.some(record => record.codigo.toLocaleLowerCase('es-CO') === codigo.toLocaleLowerCase('es-CO'))) {
          throw new Error('El código de animal ya existe en esta finca.')
        }
        if (madreId && !animals.some(record => record.id === madreId && record.sexo === 'hembra')) {
          throw new Error('Selecciona una madre de esta finca.')
        }
        await saveAnimal(user.id, { fincaId: farmId, nombre: text('nombre'), codigo, madreId,
          sexo: text('sexo'), categoria: optional('categoria'), nacimiento: optional('nacimiento'), registrarNacimiento: birth,
          raza: optional('raza'), estado: text('estado') })
      } else {
        const animalId = text('animal')
        if (!names.has(animalId)) throw new Error('Selecciona un animal de esta finca.')
        await saveEvent(user.id, { fincaId: farmId, animalId, nombre: text('nombre'), fecha: text('fecha'),
          tipo: text('tipo'), producto: optional('producto'), responsableId: optional('responsable'),
          certificado: optional('certificado'), observaciones: optional('observaciones') })
      }
      form.reset()
      if (animal) setBirth(false)
      setNotice('Guardado localmente. Pendiente de sincronizar.')
    })
  }

  return <main className="shell">
    <div className="intro"><p className="eyebrow">GANADERÍA</p><h1>Animales y sanidad</h1>
      <p>Consulta el hato y registra animales y eventos sanitarios.</p></div>
    <section className="catalog-bar" aria-label="Controles de Ganadería">
      <label>Finca ganadera<select value={farmId} disabled={busy} onChange={event => setSelectedFarm(event.target.value)}>
        {!farms.length && <option value="">Sin fincas descargadas</option>}
        {farms.map(farm => <option key={farm.id} value={farm.id}>{farm.nombre}</option>)}
      </select></label>
      {expiresAt && expiresAt > Date.now() && <p>Autorización offline hasta {new Date(expiresAt).toLocaleString('es-CO')}.</p>}
      <div className="session-tools">
        <button className="secondary" disabled={offline || busy || !ready || !farms.length} onClick={() => void run(async () => {
          const grant = await prepareGrant()
          onPrepared(grant.expiresAt)
          setNotice('Dispositivo preparado para trabajar sin conexión.')
        })}>Preparar Ganadería offline</button>
        <button className="secondary" disabled={offline || busy} onClick={() => void run(() => fetchSnapshot(user.id))}>Actualizar Ganadería</button>
        <button className="secondary" disabled={offline || busy || !pending || !canCreateEvent} onClick={() => void run(async () => {
          const count = await syncLivestock(user.id, farmId, entity => entity === 'animal' ? canCreateAnimal : canCreateEvent)
          setNotice(`${count} ${count === 1 ? 'registro confirmado' : 'registros confirmados'} en SuiteCRM.`)
        })}>Sincronizar Ganadería</button>
      </div>
    </section>
    {error && <p role="alert" className="notice error">{error}</p>}
    {notice && <p role="status" className="notice success">{notice}</p>}
    <div className="grid" key={farmId}>
      {canCreateAnimal && <form className="card" onSubmit={event => capture('animal', event)}>
        <header className="card-heading"><h2>Registrar animal</h2></header>
        <fieldset disabled={busy}><legend className="sr-only">Datos del animal</legend><div className="fields">
          <label>Código<input name="codigo" maxLength={30} required /></label>
          <label>Nombre del animal<input name="nombre" maxLength={255} required /></label>
          <label>Sexo<select name="sexo" defaultValue="" required><option value="">Selecciona</option>{choices(SEX)}</select></label>
          <label>Categoría<select name="categoria"><option value="">Sin categoría</option>{choices(CATEGORY)}</select></label>
          <label><input type="checkbox" checked={birth} onChange={event => setBirth(event.target.checked)} /> Registrar nacimiento</label>
          <label>Fecha de nacimiento<input name="nacimiento" type="date" min="0001-01-01" max={today} required={birth} /></label>
          <label>Madre<select name="madre" required={birth}><option value="">Desconocida</option>
            {animals.filter(animal => animal.sexo === 'hembra').map(animal =>
              <option key={animal.id} value={animal.id}>{animal.nombre} · {animal.codigo}</option>)}
          </select></label>
          <label>Raza<input name="raza" maxLength={100} /></label>
          <label>Estado<select name="estado" defaultValue="activo" required>{choices(STATUS)}</select></label>
        </div><button className="primary" type="submit">Guardar animal</button></fieldset>
      </form>}
      {canCreateEvent && <form className="card" onSubmit={event => capture('evento', event)}>
        <header className="card-heading"><h2>Registrar evento sanitario</h2></header>
        <fieldset disabled={busy}><legend className="sr-only">Datos del evento sanitario</legend><div className="fields">
          <label>Animal<select name="animal" defaultValue="" required><option value="">Selecciona</option>
            {animals.map(animal => <option key={animal.id} value={animal.id}>{animal.nombre} · {animal.codigo}</option>)}
          </select></label>
          <label>Nombre del evento<input name="nombre" maxLength={255} required /></label>
          <label>Fecha del evento<input name="fecha" type="date" min="0001-01-01" max="9999-12-31" defaultValue={today} required /></label>
          <label>Tipo de evento<select name="tipo" defaultValue="" required><option value="">Selecciona</option>{choices(EVENT)}</select></label>
          <label>Producto o procedimiento<input name="producto" maxLength={150} /></label>
          <label>Responsable<select name="responsable"><option value="">Sin responsable</option>
            {data.contactos.map(contact => <option key={contact.id} value={contact.id}>{contact.nombre}</option>)}
          </select></label>
          <label>Referencia del certificado<input name="certificado" maxLength={100} /></label>
          <label>Observaciones<textarea name="observaciones" maxLength={4000} rows={2} /></label>
        </div><button className="primary" type="submit" disabled={!animals.length}>Guardar evento</button></fieldset>
      </form>}
    </div>
    <section className="card history" aria-label="Animales">
      <header className="card-heading"><h2>Animales</h2></header>
      {!animals.length ? <p className="empty">No hay animales disponibles para esta finca.</p> : <div className="table-wrap"><table>
        <thead><tr><th>Animal</th><th>Sexo y categoría</th><th>Nacimiento y edad</th><th>Madre</th><th>Raza y estado</th><th>Sincronización</th></tr></thead>
        <tbody>{animals.map(animal => <tr key={animal.id}>
          <td><strong>{animal.nombre}</strong><small>{animal.codigo}</small></td>
          <td>{label(SEX, animal.sexo)}<small>{label(CATEGORY, animal.categoria)}</small></td>
          <td>{animal.nacimiento ? labelDate(animal.nacimiento) : '—'}<small>{age(animal.nacimiento, today)}</small></td>
          <td>{animal.madreId ? names.get(animal.madreId) ?? 'Animal no disponible' : 'Desconocida'}</td>
          <td>{animal.raza || '—'}<small>{label(STATUS, animal.estado)}</small></td>
          <td><State crmId={animal.crmId} /></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    <section className="card history" aria-label="Eventos sanitarios">
      <header className="card-heading"><h2>Eventos sanitarios</h2>
        <button className="secondary" disabled={!events.length} onClick={() => downloadCsv('sanidad-agrosync.csv',
          ['Evento','Animal','Fecha','Tipo','Responsable','Producto','Certificado','Observaciones','Estado'],
          events.map(event => [event.nombre, names.get(event.animalId) ?? event.animalId, event.fecha,
            label(EVENT, event.tipo), contactNames.get(event.responsableId ?? '') ?? '', event.producto ?? '',
            event.certificado ?? '', event.observaciones ?? '', event.crmId ? 'Confirmado' : 'Pendiente']))}>Exportar historial sanitario</button>
      </header>
      {!events.length ? <p className="empty">No hay eventos sanitarios para esta finca.</p> : <div className="table-wrap"><table>
        <thead><tr><th>Evento</th><th>Animal</th><th>Fecha y tipo</th><th>Responsable</th><th>Detalle</th><th>Sincronización</th></tr></thead>
        <tbody>{events.map(event => <tr key={event.id}>
          <td><strong>{event.nombre}</strong></td><td>{names.get(event.animalId) ?? 'Animal no disponible'}</td>
          <td>{labelDate(event.fecha)}<small>{label(EVENT, event.tipo)}</small></td>
          <td>{event.responsableId ? contactNames.get(event.responsableId) ?? 'Contacto no disponible' : '—'}</td>
          <td>{event.producto || '—'}{event.certificado && <small>Certificado: {event.certificado}</small>}
            {event.observaciones && <small className="livestock-notes">{event.observaciones}</small>}</td>
          <td><State crmId={event.crmId} /></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </main>
}

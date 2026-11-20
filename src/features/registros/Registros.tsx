import { useEffect, useRef, useState, type FormEvent } from 'react'
import { discardGrant, type User } from '../auth/auth'
import { FarmAccessDenied } from '../../shared/api'
import type { Catalogs } from '../catalogos/catalogs'
import { COFFEE } from '../recolecciones/harvests'
import { localDate } from '../../shared/format'
import { canCreateFarm, createFarm, readRecords, refreshRecords, saveChange, syncRecords, type Change, type Fields, type Module, type RecordData } from './data'

const names = { fincas: 'Fincas', lotes: 'Lotes', labores: 'Labores cafeteras', insumos: 'Insumos', cosechas: 'Recolecciones confirmadas' }
const types = { siembra: 'Siembra', fertilizacion: 'Fertilización', control_malezas: 'Control de malezas', poda: 'Poda', otra: 'Otra' }
const categories = { abono: 'Abono', alimento: 'Alimento', medicamento: 'Medicamento', otro: 'Otro' }

function summary(record: Fields) {
  return [record.nombre, record.codigo, record.loteId, record.fecha,
    record.tipo && types[record.tipo as keyof typeof types], record.unidad,
    record.categoria && categories[record.categoria as keyof typeof categories], record.recolectorId,
    record.estadoCafe && COFFEE[record.estadoCafe as keyof typeof COFFEE], record.pesoKg && `${record.pesoKg} kg`,
    record.tarifaKg && `${record.tarifaKg} COP/kg`].filter(Boolean).join(' · ')
}

export function Registros({ user, catalogs, offline, ready, prepare, authorize, afterSync }: {
  user: User; catalogs?: Catalogs; offline: boolean; ready: boolean; prepare: () => Promise<void>
  authorize: (farm: string) => Promise<boolean>; afterSync: () => Promise<void>
}) {
  const [module, setModule] = useState<Module>('fincas')
  const [selected, setFarm] = useState('')
  const farms = catalogs?.fincas ?? []
  const farm = farms.some(item => item.id === selected) ? selected : farms[0]?.id ?? ''
  const [farmCreation, setFarmCreation] = useState(false)
  const [newFarm, setNewFarm] = useState(false)
  const [data, setData] = useState<Awaited<ReturnType<typeof readRecords>>>()
  const [editing, setEditing] = useState<RecordData>()
  const [revising, setRevising] = useState<Change>()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  const [error, setError] = useState('')
  const role = user.permisos[farm]
  const isAdmin = role === 'ADMINISTRADOR_FINCA'
  const writable = isAdmin || (role === 'REGISTRADOR' && module === 'labores')
  const withLot = module === 'labores' || module === 'cosechas'
  const lots = catalogs?.lotes.filter(lot => lot.fincaId === farm) ?? []

  useEffect(() => {
    setFarmCreation(false)
    if (offline || module !== 'fincas') return
    let current = true
    void canCreateFarm().then(allowed => { if (current) setFarmCreation(allowed) }).catch(() => {})
    return () => { current = false }
  }, [user.id, offline, module])

  useEffect(() => {
    setNewFarm(false)
    setEditing(undefined)
    setRevising(undefined)
    setCreating(false)
    setData(undefined)
  }, [farm, module])

  useEffect(() => {
    if (!farm) return
    let current = true
    async function load() {
      const cached = await readRecords(user.id, farm, module)
      if (current) setData(cached)
      if (!offline) {
        await refreshRecords(user.id, farm, module)
        const updated = await readRecords(user.id, farm, module)
        if (current) setData(updated)
      }
    }
    void load().catch(failure => {
      if (!current) return
      if (failure instanceof FarmAccessDenied) {
        discardGrant()
        setData(undefined)
      }
      setError(failure instanceof Error ? failure.message : 'La consulta no se pudo actualizar.')
    })
    return () => { current = false }
  }, [user.id, farm, module, offline])

  async function run(action: () => Promise<unknown>) {
    if (active.current) return
    active.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      if (farm) setData(await readRecords(user.id, farm, module))
    } catch (failure) {
      if (failure instanceof FarmAccessDenied) {
        discardGrant()
        setData(undefined)
      }
      setError(failure instanceof Error ? failure.message : 'La operación no se pudo completar.')
    } finally {
      active.current = false
      setBusy(false)
    }
  }

  function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const get = (name: string) => String(fields.get(name) ?? '').trim()
    void run(async () => {
      if (!writable || (editing && !isAdmin) || !(await authorize(farm))) throw new Error('La finca no está autorizada.')
      const change: Change = { entity: 'registro', owner: user.id, modulo: module,
        operationId: crypto.randomUUID(), fincaId: farm, queuedAt: Date.now(), nombre: get('nombre'),
        id: editing?.id, version: editing?.version,
        ...(withLot ? { loteId: get('lote'), fecha: get('fecha') } : { codigo: get('codigo') }),
        ...(module === 'labores' ? { tipo: get('tipo') } : {}),
        ...(module === 'cosechas' ? { recolectorId: get('recolector'), estadoCafe: get('estadoCafe'),
          pesoKg: get('pesoKg').replace(',', '.'), tarifaKg: get('tarifaKg').replace(',', '.') } : {}),
        ...(module === 'insumos' ? { unidad: editing?.unidad ?? get('unidad'), categoria: get('categoria') } : {}),
      }
      if (module === 'cosechas' && (!/^[0-9]{1,11}(\.[0-9]{1,3})?$/.test(change.pesoKg ?? '')
          || !/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(change.tarifaKg ?? '')
          || Number(change.pesoKg) <= 0 || Number(change.tarifaKg) <= 0)) {
        throw new Error('Indica peso y tarifa positivos y respeta la precisión de cada campo.')
      }
      await saveChange(change, revising)
      setEditing(undefined)
      setRevising(undefined)
      setCreating(false)
    })
  }

  function registerFarm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    void run(async () => {
      await createFarm(user.id, String(fields.get('nombre') ?? '').trim(), String(fields.get('codigo') ?? '').trim())
      await afterSync()
      window.location.reload()
    })
  }

  const open = data?.changes.filter(change => !change.superseded && change.state !== 'confirmed') ?? []
  const selectedRecord = revising ?? editing
  return <main className="shell">
    <div className="intro"><div><h1>Registros de finca</h1><p>Fincas, lotes, labores cafeteras e insumos</p></div></div>
    <section className="card">
      <div className="fields">
        <label>Finca del registro<select value={farm} disabled={busy} onChange={event => setFarm(event.target.value)}>
          {farms.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>
        <label>Tipo de registro<select value={module} disabled={busy} onChange={event => setModule(event.target.value as Module)}>
          {Object.entries(names).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      </div>
      <button disabled={busy || offline || !ready || !data} onClick={() => void run(prepare)}>Preparar registros offline</button>
      <button disabled={busy || offline || !writable || !open.some(change => !change.conflict)}
        onClick={() => void run(async () => { await syncRecords(user.id, farm, module); await afterSync() })}>Sincronizar registros</button>
      {error && <p role="alert">{error}</p>}
    </section>
    <section className="card"><h2>{names[module]}</h2>
      {farmCreation && !offline && module === 'fincas' && <button disabled={busy} onClick={() => setNewFarm(true)}>Nueva finca</button>}
      {writable && module !== 'fincas' && module !== 'cosechas' && <button disabled={busy}
        onClick={() => { setEditing(undefined); setRevising(undefined); setCreating(true) }}>Nuevo registro</button>}
      <ul>{data?.records.map(record => <li key={record.id}>
        {record.nombre} {record.codigo ?? record.fecha} · Confirmado en SuiteCRM
        {isAdmin && <button disabled={busy || open.some(change => change.id === record.id)}
          onClick={() => { setEditing(record); setRevising(undefined); setCreating(false) }}>Editar</button>}
      </li>)}</ul>
      <ul>{open.map(change => {
        const central = data?.records.find(record => record.id === change.id)
        return <li key={change.operationId}>{change.nombre} · {change.conflict ? 'Conflicto' : change.issue ? 'Error de envío' : 'Pendiente de sincronizar'}
          {change.issue && <p>{change.issue} Identificador: {change.operationId}</p>}
          {change.conflict && central && <div><p>Versión confirmada: {summary(central)}</p><p>Tu borrador: {summary(change)}</p>
            {isAdmin && <button disabled={busy} onClick={() => void run(async () => {
              if (await authorize(farm)) await saveChange({ ...change, superseded: true })
            })}>Conservar versión de SuiteCRM</button>}</div>}
          {writable && change.conflict && (!change.id || (isAdmin && central)) &&
            <button disabled={busy || offline} onClick={() => {
              setEditing(central); setCreating(!central); setRevising(change)
            }}>Revisar cambios</button>}
        </li>
      })}</ul>
    </section>
    {newFarm && farmCreation && !offline && module === 'fincas' && <form className="card" onSubmit={registerFarm}>
      <h2>Nueva finca</h2>
      <p>SuiteCRM creará un grupo de seguridad para la finca con tu cuenta como integrante inicial.</p>
      <fieldset disabled={busy}><div className="fields">
        <label>Nombre de la finca<input name="nombre" required maxLength={255} /></label>
        <label>Código de la finca<input name="codigo" required maxLength={30} /></label>
      </div><button className="primary">Registrar finca</button></fieldset>
    </form>}
    {writable && (editing || creating) && <form className="card" key={revising?.operationId ?? editing?.id ?? 'nuevo'} onSubmit={capture}>
      <h2>{revising ? 'Resolver conflicto' : editing ? 'Editar registro' : 'Nuevo registro'}</h2>
      {revising && <p>Comprueba los datos centrales de arriba y ajusta el borrador antes de guardarlo de nuevo.</p>}
      <fieldset disabled={busy}><div className="fields">
        <label>Nombre<input name="nombre" required maxLength={255} defaultValue={selectedRecord?.nombre} /></label>
        {!withLot && <label>Código<input name="codigo" required maxLength={30} defaultValue={selectedRecord?.codigo} /></label>}
        {withLot && <>
          <label>Lote<select name="lote" required defaultValue={selectedRecord?.loteId ?? ''}>
            <option value="">Selecciona un lote</option>
            {lots.map(lot => <option key={lot.id} value={lot.id}>{lot.nombre}</option>)}</select></label>
          <label>Fecha<input name="fecha" type="date" required defaultValue={selectedRecord?.fecha ?? localDate()} /></label>
        </>}
        {module === 'labores' && <label>Labor<select name="tipo" required defaultValue={selectedRecord?.tipo ?? ''}>
            <option value="">Selecciona una labor</option>
            {Object.entries(types).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>}
        {module === 'cosechas' && <>
          <label>Recolector<select name="recolector" required defaultValue={selectedRecord?.recolectorId ?? ''}>
            <option value="">Selecciona un recolector</option>
            {catalogs?.contactos.map(contact => <option key={contact.id} value={contact.id}>{contact.nombre}</option>)}</select></label>
          <label>Estado del café<select name="estadoCafe" required defaultValue={selectedRecord?.estadoCafe ?? ''}>
            <option value="">Selecciona un estado</option>
            {Object.entries(COFFEE).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
          <label>Peso en kg<input name="pesoKg" inputMode="decimal" required defaultValue={selectedRecord?.pesoKg} /></label>
          <label>Tarifa COP/kg<input name="tarifaKg" inputMode="decimal" required defaultValue={selectedRecord?.tarifaKg} /></label>
        </>}
        {module === 'insumos' && <>
          <label>Unidad<select name="unidad" disabled={Boolean(editing)} defaultValue={selectedRecord?.unidad ?? 'kg'}>
            <option value="kg">kg</option><option value="l">l</option><option value="unidad">Unidad</option></select></label>
          <label>Categoría<select name="categoria" defaultValue={selectedRecord?.categoria || 'otro'}>
            {Object.entries(categories).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        </>}
      </div><button className="primary">Guardar registro</button></fieldset>
    </form>}
  </main>
}

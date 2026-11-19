import { useRef, useState, type FormEvent } from 'react'
import type { Catalogs } from '../catalogos/catalogs'
import { localDate } from '../../shared/format'
import { COFFEE, positiveUnits, saveHarvest, type Harvest } from './harvests'

export function HarvestForm({ catalogs, onSave, owner, authorize, onFarmChange }: { catalogs?: Catalogs; onFarmChange: (farm: string) => void; onSave: (record: Harvest) => void; owner: string; authorize: (farm: string) => Promise<boolean> }) {
  const [farm, setFarm] = useState('')
  const [lot, setLot] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const lots = catalogs?.lotes.filter(item => item.fincaId === farm) ?? []
  const canSave = Boolean(catalogs?.fincas.length && catalogs?.contactos.length && lots.length)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return
    const form = event.currentTarget
    const values = new FormData(form)
    const finca = catalogs?.fincas.find(item => item.id === farm)
    const lote = lots.find(item => item.id === lot)
    const recolector = catalogs?.contactos.find(item => item.id === values.get('recolector'))
    const fecha = String(values.get('fecha') ?? '')
    const estado = values.get('estado')
    const pesoGramos = positiveUnits(String(values.get('cantidad') ?? ''), 3)
    const tarifaCentavos = positiveUnits(String(values.get('tarifa') ?? ''), 2)
    setNotice('')
    setError('')
    if (!finca || !lote || !recolector || !fecha || (estado !== 'cereza' && estado !== 'pergamino')) {
      setError('Completa todos los campos de la recolección.')
      return
    }
    if (pesoGramos === null || tarifaCentavos === null) {
      setError('Usa valores positivos, con hasta 3 decimales para el peso y 2 para la tarifa.')
      return
    }
    pending.current = true
    setSaving(true)
    try {
      if (!await authorize(finca.id)) {
        setError("La autorización no permite registrar en esta finca. Inicia sesión nuevamente.")
        return
      }
      const record = await saveHarvest({
        owner,
        finca, lote, recolector, fecha, pesoGramos, tarifaCentavos, estadoCafe: estado,
      })
      onSave(record)
      const quantity = form.elements.namedItem('cantidad') as HTMLInputElement
      quantity.value = ''
      setNotice('Guardado localmente. Pendiente de sincronizar.')
    } catch {
      setError('No se pudo guardar la recolección. Los datos del formulario se conservaron para volver a intentar.')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return <form className="card capture" onSubmit={submit}>
    <header className="card-heading">
      <div className="symbol" aria-hidden="true">+</div>
      <div><h2>Nueva recolección</h2><p>Registra el peso y la tarifa aplicados en campo.</p></div>
    </header>
    <fieldset disabled={saving}>
      <legend className="sr-only">Datos de la recolección</legend>
      <div className="fields">
        <label>Finca
          <select value={farm} onChange={event => { setFarm(event.target.value); setLot(''); if (event.target.value) onFarmChange(event.target.value) }} required>
            <option value="">Selecciona una finca</option>
            {catalogs?.fincas.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
          </select>
        </label>
        <label>Lote
          <select value={lot} onChange={event => setLot(event.target.value)} required disabled={!lots.length}>
            <option value="">{farm ? 'Selecciona un lote' : 'Elige primero una finca'}</option>
            {lots.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
          </select>
        </label>
        {farm && !lots.length && <p className="field-note" role="status">Esta finca no tiene lotes en el catálogo descargado.</p>}
        <label>Recolector
          <select name="recolector" required>
            <option value="">Selecciona un contacto</option>
            {catalogs?.contactos.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
          </select>
        </label>
        <label>Fecha de recolección<input name="fecha" type="date" min="0001-01-01" max="9999-12-24" defaultValue={localDate()} required /></label>
        <label>Cantidad (kg)<input name="cantidad" inputMode="decimal" placeholder="0,000" required /></label>
        <label>Tarifa por kilogramo (COP)<input name="tarifa" inputMode="decimal" placeholder="0,00" required /></label>
        <label className="full">Estado del café
          <select name="estado" required defaultValue="">
            <option value="">Selecciona el estado del café</option>
            {Object.entries(COFFEE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <button className="primary" type="submit" disabled={!canSave || saving}>
        {saving ? 'Guardando…' : 'Guardar recolección'}
      </button>
    </fieldset>
    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </form>
}

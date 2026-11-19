import { useEffect, useState } from 'react'
import type { CatalogEntry } from '../catalogos/catalogs'
import { HarvestList } from '../recolecciones/HarvestList'
import type { Harvest } from '../recolecciones/harvests'
import { localDate } from '../../shared/format'
import { WeeklySummary } from './WeeklySummary'
import { weekRange } from './settlement'
import { downloadWeekly, mergeWeekly, readWeekly, weeklyKey, WeeklyAccessDenied, type Snapshot } from './weeklyHarvests'

interface View {
  key: string
  snapshot?: Snapshot
  status: string
  denied?: boolean
}

export function WeeklyHarvests({ owner, farms, selected, select, records, offline, revision }: {
  owner: string; farms: CatalogEntry[]; selected: string; select: (id: string) => void;
  records: Harvest[]; offline: boolean; revision: number
}) {
  const [date, setDate] = useState(localDate)
  const [view, setView] = useState<View>()
  const day = date || localDate()
  const { start, end } = weekRange(day)
  const farm = farms.find(entry => entry.id === selected) ?? farms[0]
  const farmId = farm?.id ?? ''
  const key = farmId ? weeklyKey(owner, farmId, start) : ''
  const current = view?.key === key ? view : undefined

  useEffect(() => {
    if (!key) return
    let active = true
    async function load() {
      let snapshot: Snapshot | undefined
      try { snapshot = await readWeekly(key) }
      catch { /* A failed local read does not prevent loading SuiteCRM online. */ }
      if (!active) return
      setView({ key, snapshot, status: offline
        ? snapshot ? 'Sin conexión. Se muestra la última descarga y los pendientes locales.'
          : 'Semana sin descarga previa. Solo se muestran registros de este dispositivo.'
        : 'Actualizando recolecciones de SuiteCRM…' })
      if (offline) return
      try {
        snapshot = await downloadWeekly(key, farmId, start, end)
        if (active) setView({ key, snapshot, status: '' })
      } catch (failure) {
        if (!active) return
        if (failure instanceof WeeklyAccessDenied) setView({ key, status: failure.message, denied: true })
        else setView({ key, snapshot, status: snapshot
          ? 'No se pudo actualizar SuiteCRM. Se muestra la última descarga y los pendientes locales.'
          : 'No se pudo consultar SuiteCRM. Se muestran los registros de este dispositivo.' })
      }
    }
    void load()
    return () => { active = false }
  }, [key, farmId, start, end, offline, revision])

  const visible = key && !current?.denied ? mergeWeekly(records, current?.snapshot, farmId, start, end) : []
  const status = key ? current?.status ?? 'Cargando recolecciones…' : 'Selecciona una finca autorizada.'
  return <>
    <WeeklySummary records={visible} date={day} farm={farm?.nombre} status={status} complete={Boolean(current?.snapshot)}
      controls={<div className="fields">
        <label>Finca de consulta<select value={farmId} onChange={event => select(event.target.value)} disabled={!farms.length}>
          {!farms.length && <option value="">Sin fincas disponibles</option>}
          {farms.map(entry => <option key={entry.id} value={entry.id}>{entry.nombre}</option>)}
        </select></label>
        <label>Semana de la fecha<input type="date" min="0001-01-01" max="9999-12-24" value={date}
          onChange={event => { if (event.target.validity.valid) setDate(event.target.value) }} /></label>
      </div>} />
    <div className="weekly-harvest-list"><HarvestList records={visible} /></div>
  </>
}

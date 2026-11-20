import { downloadCsv } from '../../shared/csv'
import { kg, labelDate, money } from '../../shared/format'
import { COFFEE } from './harvests'
import type { WeeklyHarvest } from '../liquidacion/weeklyHarvests'

export function HarvestList({ records }: { records: WeeklyHarvest[] }) {
  return <section className="card history" aria-labelledby="history">
    <header className="card-heading">
      <div><h2 id="history">Recolecciones de la semana</h2><p>{records.length} {records.length === 1 ? 'registro' : 'registros'}</p></div>
      <button className="secondary" disabled={!records.length} onClick={() => downloadCsv('cafe-agrosync.csv',
        ['Recolector','Finca','Lote','Fecha','Café','Kilogramos','COP por kg','Estado'],
        records.map(record => [record.recolector.nombre, record.finca.nombre, record.lote.nombre,
          record.fecha, COFFEE[record.estadoCafe], (record.pesoGramos / 1000).toFixed(3),
          (record.tarifaCentavos / 100).toFixed(2), record.crmId ? 'Confirmado' : 'Pendiente']))}>Exportar recolecciones</button>
    </header>
    {!records.length ? <p className="empty">No hay recolecciones disponibles para la selección.</p> :
      <div className="table-wrap"><table>
        <thead><tr><th>Recolector</th><th>Finca y lote</th><th>Fecha</th><th>Café</th><th>Peso</th><th>Tarifa / kg</th><th>Estado</th></tr></thead>
        <tbody>{records.map(record => <tr key={record.crmId || record.id}>
          <td><strong>{record.recolector.nombre}</strong></td>
          <td>{record.finca.nombre}<small>{record.lote.nombre}</small></td><td>{labelDate(record.fecha)}</td>
          <td>{COFFEE[record.estadoCafe]}</td><td>{kg(record.pesoGramos)} kg</td>
          <td>{money(BigInt(record.tarifaCentavos))}</td>
          <td><span className={`tag ${record.crmId ? 'online' : 'pending'}`}>
            {record.crmId ? 'Confirmado en SuiteCRM' : 'Pendiente de sincronizar'}
          </span>{!record.crmId && <small>Guardado localmente</small>}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>
}

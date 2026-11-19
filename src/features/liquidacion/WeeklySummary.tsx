import { kg, labelDate, money } from '../../shared/format'
import type { ReactNode } from 'react'
import type { WeeklyHarvest } from './weeklyHarvests'
import { weeklySettlement } from './settlement'

export function WeeklySummary({ records, date, farm, controls, status, complete }: {
  records: WeeklyHarvest[]; date: string; farm?: string; controls: ReactNode; status: string; complete: boolean
}) {
  const summary = weeklySettlement(records, date)
  return <section className="card summary" aria-labelledby="summary">
    <header className="card-heading">
      <div><h2 id="summary">Liquidación semanal</h2><p>Total y desglose por recolector.</p></div>
    </header>
    {controls}
    {status && <p className="notice" role="status">{status}</p>}
    <div className="weekly-total">
      <span>{complete ? 'Total de la finca' : 'Total disponible'}{farm && ` · ${farm}`}</span>
      <strong data-testid="weekly-total">{money(summary.total)} COP</strong>
      <small>{labelDate(summary.start)} – {labelDate(summary.end)}</small>
    </div>
    {!summary.rows.length ? <p className="empty">Sin recolecciones disponibles para esta finca y semana.</p> :
      <ul className="settlements">{summary.rows.map(row => <li key={row.id}>
        <div><strong>{row.name}</strong><small>{kg(row.grams)} kg · {row.count} {row.count === 1 ? 'registro' : 'registros'}</small></div>
        <b>{money(row.cents)}</b>
      </li>)}</ul>}
  </section>
}

import { useState, type ReactNode } from 'react'

const PAGE_SIZES = [5, 10, 20, 50]

export function PaginatedTable<Row>({ label, scope, rows, columns, empty, children }: {
  label: string
  scope: string
  rows: readonly Row[]
  columns: readonly string[]
  empty?: ReactNode
  children: (rows: readonly Row[]) => ReactNode
}) {
  const [pageSize, setPageSize] = useState(10)
  const [position, setPosition] = useState({ scope, page: 1 })
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = position.scope === scope ? Math.min(position.page, pageCount) : 1
  if (position.scope !== scope || position.page !== page) setPosition({ scope, page })

  const start = (page - 1) * pageSize
  const end = Math.min(start + pageSize, rows.length)

  return <>
    <label className="table-page-size">Registros por página
      <select value={pageSize} onChange={event => {
        setPageSize(Number(event.target.value))
        setPosition({ scope, page: 1 })
      }}>
        {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>
    {!rows.length && empty ? empty : <div className="table-wrap"><table aria-label={label}>
      <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>{children(rows.slice(start, end))}</tbody>
    </table></div>}
    {pageCount > 1 && <nav className="table-pagination" aria-label={`Paginación de ${label}`}>
      <p aria-live="polite">Mostrando {start + 1}–{end} de {rows.length} · Página {page} de {pageCount}</p>
      <div className="action-group">
        <button type="button" className="secondary" disabled={page === 1} onClick={() => setPosition({ scope, page: page - 1 })}>Anterior</button>
        <button type="button" className="secondary" disabled={page === pageCount} onClick={() => setPosition({ scope, page: page + 1 })}>Siguiente</button>
      </div>
    </nav>}
  </>
}

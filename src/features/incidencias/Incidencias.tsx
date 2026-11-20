import { useEffect, useState } from 'react'
import type { User } from '../auth/auth'
import { readIssues } from './incidents'

const labels: Record<string, string> = {
  inventario: 'Inventario', registro: 'Registros', recoleccion: 'Café', animal: 'Animales', 'evento-sanitario': 'Eventos sanitarios',
}

export function Incidencias({ user }: { user: User }) {
  const [issues, setIssues] = useState<Awaited<ReturnType<typeof readIssues>>>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void readIssues(user.id, Object.keys(user.permisos))
      .then(rows => { if (active) setIssues(rows) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [user])

  return <main className="shell">
    <div className="intro"><div><h1>Incidencias de sincronización</h1><p>Operaciones de este dispositivo y tus fincas autorizadas</p></div></div>
    <section className="card">
      {failed ? <p className="notice error" role="alert">No fue posible abrir las incidencias locales.</p> : !issues.length
        ? <p className="empty">No hay incidencias guardadas en este dispositivo.</p>
        : <div className="table-wrap"><table><thead><tr><th>Módulo</th><th>Identificador de operación</th><th>Estado</th><th>Causa</th></tr></thead>
          <tbody>{issues.map(op => <tr key={op.operationId}><td>{labels[op.entity]}</td><td><code>{op.operationId}</code></td>
            <td><span className={`tag ${op.state === 'confirmed' ? 'online'
              : op.superseded || op.discarded ? 'neutral' : op.conflict ? 'pending' : 'error'}`}>
              {op.state === 'confirmed' ? 'Confirmado después de reintento'
                : op.superseded || op.discarded ? 'Revisado' : op.conflict ? 'Conflicto' : 'Error pendiente'}
            </span></td><td className="table-detail">{op.issue}</td></tr>)}</tbody>
        </table></div>}
    </section>
  </main>
}

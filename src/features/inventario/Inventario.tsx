import { useEffect, useRef, useState, type FormEvent } from 'react'
import { discardGrant, type User } from '../auth/auth'
import { downloadCsv } from '../../shared/csv'
import { PaginatedTable } from '../../shared/PaginatedTable'
import { FarmAccessDenied } from '../../shared/api'
import { readInventory, refreshInventory, saveInventory, type Movement, type Operation } from './data'
import type { Catalogs } from '../catalogos/catalogs'

type Props = {
  user: User; farms: Catalogs['fincas']; offline: boolean; revision: number; expiresAt?: number
  authorize: (farm: string) => Promise<boolean>
}

function thousandths(value: string) {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
}

function decimal(value: bigint) {
  const abs = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${abs / 1000n}.${String(abs % 1000n).padStart(3, '0')}`
}

function exportHistory(snapshot: NonNullable<Awaited<ReturnType<typeof readInventory>>['snapshot']>) {
  const columns = ['Fecha (UTC)', 'Insumo', 'Unidad', 'Movimiento', 'Cantidad', 'Identificador', 'Origen', 'Referencia']
  const rows = snapshot.movimientos.map(movement => {
    const item = snapshot.insumos.find(supply => supply.id === movement.insumoId)
    return [movement.fecha, item?.nombre ?? movement.insumoId, item?.unidad ?? '', movement.tipo,
      movement.cantidad, movement.id, movement.origenId ?? '', movement.referencia ?? '']
  })
  downloadCsv('inventario-agrosync.csv', columns, rows)
}

export function Inventario({ user, farms, offline, revision, expiresAt, authorize }: Props) {
  const [selected, select] = useState('')
  const farm = farms.some(item => item.id === selected) ? selected : farms[0]?.id ?? ''
  const role = user.permisos[farm]
  const [loaded, setLoaded] = useState<{ owner: string; farm: string; data: Awaited<ReturnType<typeof readInventory>> }>()
  const data = loaded?.owner === user.id && loaded.farm === farm ? loaded.data : undefined
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(false)

  useEffect(() => {
    let current = true
    if (!farm) return
    const load = async () => {
      const local = await readInventory(user.id, farm)
      if (current) setLoaded({ owner: user.id, farm, data: local })
      if (!offline) {
        await refreshInventory(user.id, farm)
        const updated = await readInventory(user.id, farm)
        if (current) setLoaded({ owner: user.id, farm, data: updated })
      }
    }
    void load().catch(failure => {
      if (!current) return
      if (failure instanceof FarmAccessDenied) {
        discardGrant()
        setLoaded(undefined)
      }
      setError(failure instanceof Error ? failure.message : 'La consulta no se pudo actualizar.')
    })
    return () => { current = false }
  }, [user.id, farm, offline, revision])

  async function run(action: () => Promise<unknown>) {
    if (active.current || !farm) return
    active.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      setLoaded({ owner: user.id, farm, data: await readInventory(user.id, farm) })
    } catch (failure) {
      if (failure instanceof FarmAccessDenied) {
        discardGrant()
        setLoaded(undefined)
      }
      setError(failure instanceof Error ? failure.message : 'No se pudo completar la operación.')
    } finally {
      active.current = false
      setBusy(false)
    }
  }

  const snapshot = data?.snapshot
  const supplies = snapshot?.insumos ?? []
  const movements = snapshot?.movimientos ?? []
  const supplyNames = new Map(supplies.map(item => [item.id, item.nombre]))
  const confirmed = new Set(movements.map(movement => movement.id))
  const pending = data?.operations.filter(op => !confirmed.has(op.operationId) && op.state !== 'confirmed') ?? []
  const canWrite = Boolean(role && role !== 'CONSULTA' && (!offline || (expiresAt && expiresAt > Date.now())))

  async function queue(item: string, type: Movement['tipo'], amount: string, reference: string, origin?: string) {
    const supply = snapshot?.insumos.find(candidate => candidate.id === item && candidate.estado === 'activo')
    const value = amount.trim().replace(',', '.')
    if (!supply || !/^[0-9]{1,11}(\.[0-9]{1,3})?$/.test(value) || thousandths(value) <= 0n) {
      throw new Error('Elige un insumo activo y una cantidad positiva con hasta tres decimales.')
    }
    if (!canWrite || !(await authorize(farm))) throw new Error('La finca no está autorizada para registrar.')
    const operation: Operation = { operationId: crypto.randomUUID(), owner: user.id, entity: 'inventario',
      fincaId: farm, insumoId: item, tipo: type, cantidad: value, unidad: supply.unidad,
      referencia: reference, origenId: origin, queuedAt: Date.now() }
    await saveInventory(operation)
  }

  function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    void run(async () => {
      await queue(String(fields.get('insumo')), String(fields.get('tipo')) as Movement['tipo'],
        String(fields.get('cantidad')), String(fields.get('referencia')))
      form.reset()
    })
  }

  return <main className="shell">
    <div className="intro"><div><h1>Inventario</h1><p>Existencias y movimientos por finca</p></div></div>
    <div className="module-stack">
      <section className="card module-toolbar">
        <label>Finca de inventario<select value={farm} disabled={busy} onChange={event => select(event.target.value)}>
          {farms.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
        </select></label>
        {error && <p className="notice error" role="alert">{error}</p>}
      </section>
      <section className="card" aria-labelledby="inventory-stock"><header className="card-heading"><h2 id="inventory-stock">Existencias</h2></header>
        {!snapshot && <p>Descarga el inventario con conexión antes de trabajar en campo.</p>}
        <PaginatedTable label="existencias" scope={farm} rows={supplies}
          columns={['Insumo', 'Unidad', 'Confirmado', 'Provisional']}>
          {page => page.map(item => {
            const balance = pending.filter(op => op.insumoId === item.id && !op.conflict && !op.discarded)
              .reduce((total, op) => total + thousandths(op.cantidad) * (op.tipo === 'entrada' ? 1n : -1n), thousandths(item.saldo))
            return <tr key={item.id}><td>{item.nombre}</td><td>{item.unidad}</td><td>{item.saldo}</td><td>{decimal(balance)}</td></tr>
          })}
        </PaginatedTable>
      </section>
      {canWrite && !!snapshot?.insumos.length && <form className="card" onSubmit={capture}>
        <header className="card-heading"><h2>Registrar movimiento</h2></header>
        <fieldset disabled={busy}><div className="fields">
          <label>Insumo<select name="insumo" required>{snapshot.insumos.filter(item => item.estado === 'activo')
            .map(item => <option key={item.id} value={item.id}>{item.nombre} ({item.unidad})</option>)}</select></label>
          <label>Movimiento<select name="tipo"><option value="entrada">Entrada</option><option value="salida">Salida</option></select></label>
          <label>Cantidad<input name="cantidad" required inputMode="decimal" /></label>
          <label>Referencia<input name="referencia" maxLength={100} /></label>
        </div><button className="primary">Guardar movimiento</button></fieldset>
      </form>}
      <section className="card" aria-labelledby="inventory-history">
        <header className="card-heading card-heading-with-actions">
          <h2 id="inventory-history">Historial</h2>
          <button className="secondary" disabled={!snapshot?.movimientos.length}
            onClick={() => snapshot && exportHistory(snapshot)}>Exportar movimientos confirmados</button>
        </header>
        <PaginatedTable label="movimientos de inventario" scope={farm} rows={[...pending, ...movements]}
          columns={['Insumo', 'Movimiento', 'Cantidad', 'Estado']}>
          {page => page.map(movement => {
            if ('operationId' in movement) {
              const op = movement
              return <tr key={op.operationId}><td>{supplyNames.get(op.insumoId)}</td>
                <td>{op.tipo}</td><td>{op.cantidad}</td><td className="table-detail">
                  <span className={`tag ${op.discarded ? 'neutral' : op.issue && !op.conflict ? 'error' : 'pending'}`}>
                    {op.discarded ? 'Descartado localmente' : op.conflict ? 'Conflicto' : op.issue ? 'Error de envío' : 'Pendiente de sincronizar'}
                  </span>
                  {op.issue && <p className="record-detail">{op.issue} Identificador: {op.operationId}</p>}
                  {canWrite && op.conflict && !op.discarded && <button className="secondary row-action" type="button" disabled={busy} onClick={() => void run(async () => {
                    if (await authorize(farm)) await saveInventory({ ...op, discarded: true }, true)
                  })}>Descartar pendiente</button>}</td></tr>
            }
            return <tr key={movement.id}>
              <td>{supplyNames.get(movement.insumoId)}</td>
              <td>{movement.tipo}{movement.origenId ? ' de compensación' : ''}</td><td>{movement.cantidad}</td>
              <td><span className="tag online">Confirmado en SuiteCRM</span>
                {canWrite && role === 'ADMINISTRADOR_FINCA' && !movement.origenId
                  && !movements.some(other => other.origenId === movement.id)
                  && !pending.some(op => op.origenId === movement.id && !op.conflict && !op.discarded)
                  && <button className="secondary row-action" type="button" disabled={busy} onClick={() => void run(() => queue(movement.insumoId,
                    movement.tipo === 'entrada' ? 'salida' : 'entrada', movement.cantidad, 'Compensación', movement.id))}>Compensar</button>}
              </td></tr>
          })}
        </PaginatedTable>
      </section>
    </div>
  </main>
}

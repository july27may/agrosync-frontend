import { useEffect, useRef, useState, type FormEvent } from 'react'
import { discardGrant, type User } from '../auth/auth'
import { downloadCsv } from '../../shared/csv'
import { FarmAccessDenied } from '../../shared/api'
import { readInventory, refreshInventory, saveInventory, syncInventory, type Movement, type Operation } from './data'
import type { Catalogs } from '../catalogos/catalogs'

type Props = {
  user: User; farms: Catalogs['fincas']; offline: boolean; ready: boolean; expiresAt?: number
  prepare: () => Promise<void>; authorize: (farm: string) => Promise<boolean>
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

export function Inventario({ user, farms, offline, ready, expiresAt, prepare, authorize }: Props) {
  const [selected, select] = useState('')
  const farm = farms.some(item => item.id === selected) ? selected : farms[0]?.id ?? ''
  const role = user.permisos[farm]
  const [data, setData] = useState<Awaited<ReturnType<typeof readInventory>>>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(false)

  useEffect(() => {
    let current = true
    setData(undefined)
    if (!farm) return
    const load = async () => {
      const local = await readInventory(user.id, farm)
      if (current) setData(local)
      if (!offline) {
        await refreshInventory(user.id, farm)
        const updated = await readInventory(user.id, farm)
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
  }, [user.id, farm, offline])

  async function run(action: () => Promise<unknown>) {
    if (active.current || !farm) return
    active.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      setData(await readInventory(user.id, farm))
    } catch (failure) {
      if (failure instanceof FarmAccessDenied) {
        discardGrant()
        setData(undefined)
      }
      setError(failure instanceof Error ? failure.message : 'No se pudo completar la operación.')
    } finally {
      active.current = false
      setBusy(false)
    }
  }

  const snapshot = data?.snapshot
  const confirmed = new Set(snapshot?.movimientos.map(movement => movement.id))
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
    <section className="card">
      <label>Finca de inventario<select value={farm} disabled={busy} onChange={event => select(event.target.value)}>
        {farms.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
      </select></label>
      <button className="secondary" disabled={busy || offline || !ready || !snapshot}
        onClick={() => void run(prepare)}>Preparar inventario offline</button>
      <button className="secondary" disabled={busy || offline || !canWrite || !data?.operations.some(op => !op.conflict && !op.discarded && op.state !== 'confirmed')}
        onClick={() => void run(() => syncInventory(user.id, farm))}>Sincronizar inventario</button>
      {error && <p role="alert">{error}</p>}
    </section>
    <section className="card"><h2>Existencias</h2>
      {!snapshot && <p>Descarga el inventario con conexión antes de trabajar en campo.</p>}
      <table><thead><tr><th>Insumo</th><th>Unidad</th><th>Confirmado</th><th>Provisional</th></tr></thead>
        <tbody>{snapshot?.insumos.map(item => {
          const balance = pending.filter(op => op.insumoId === item.id && !op.conflict && !op.discarded)
            .reduce((total, op) => total + thousandths(op.cantidad) * (op.tipo === 'entrada' ? 1n : -1n), thousandths(item.saldo))
          return <tr key={item.id}><td>{item.nombre}</td><td>{item.unidad}</td><td>{item.saldo}</td><td>{decimal(balance)}</td></tr>
        })}</tbody></table>
    </section>
    {canWrite && !!snapshot?.insumos.length && <form className="card" onSubmit={capture}>
      <h2>Registrar movimiento</h2>
      <fieldset disabled={busy}><div className="fields">
        <label>Insumo<select name="insumo" required>{snapshot.insumos.filter(item => item.estado === 'activo')
          .map(item => <option key={item.id} value={item.id}>{item.nombre} ({item.unidad})</option>)}</select></label>
        <label>Movimiento<select name="tipo"><option value="entrada">Entrada</option><option value="salida">Salida</option></select></label>
        <label>Cantidad<input name="cantidad" required inputMode="decimal" /></label>
        <label>Referencia<input name="referencia" maxLength={100} /></label>
      </div><button className="primary">Guardar movimiento</button></fieldset>
    </form>}
    <section className="card"><h2>Historial</h2>
      <button disabled={!snapshot?.movimientos.length} onClick={() => snapshot && exportHistory(snapshot)}>Exportar movimientos confirmados</button>
      <table><thead><tr><th>Insumo</th><th>Movimiento</th><th>Cantidad</th><th>Estado</th></tr></thead><tbody>
        {pending.map(op => <tr key={op.operationId}><td>{snapshot?.insumos.find(item => item.id === op.insumoId)?.nombre}</td>
          <td>{op.tipo}</td><td>{op.cantidad}</td><td>{op.discarded ? 'Descartado localmente' : op.conflict ? 'Conflicto' : op.issue ? 'Error de envío' : 'Pendiente de sincronizar'}
            {op.issue && <p>{op.issue} Identificador: {op.operationId}</p>}
            {canWrite && op.conflict && !op.discarded && <button type="button" disabled={busy} onClick={() => void run(async () => {
              if (await authorize(farm)) await saveInventory({ ...op, discarded: true })
            })}>Descartar pendiente</button>}</td></tr>)}
        {snapshot?.movimientos.map(movement => <tr key={movement.id}>
          <td>{snapshot.insumos.find(item => item.id === movement.insumoId)?.nombre}</td>
          <td>{movement.tipo}{movement.origenId ? ' de compensación' : ''}</td><td>{movement.cantidad}</td>
          <td><span>Confirmado en SuiteCRM</span>
            {canWrite && role === 'ADMINISTRADOR_FINCA' && !movement.origenId
              && !snapshot.movimientos.some(other => other.origenId === movement.id)
              && !pending.some(op => op.origenId === movement.id && !op.conflict && !op.discarded)
              && <button type="button" disabled={busy} onClick={() => void run(() => queue(movement.insumoId,
                movement.tipo === 'entrada' ? 'salida' : 'entrada', movement.cantidad, 'Compensación', movement.id))}>Compensar</button>}
          </td></tr>)}
      </tbody></table>
    </section>
  </main>
}

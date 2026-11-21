import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { createSupply, formatKg, formatSacks, parseKgPerSack, sacksToKg, SupplyError } from './supplies'
import { useSupplies } from './useSupplies'

export function InsumosPage() {
  const data = useSupplies()
  const [adding, setAdding] = useState(false)
  if (!data) return null
  return (
    <>
      <p className="muted" style={{ margin: '0 4px' }}>
        Estoque em sacos (aceita meio saco). O consumo no cocho é lançado por pasto e sai do estoque automaticamente.
      </p>
      <div className="card module-list" style={{ paddingTop: 6, paddingBottom: 6 }} data-testid="supplies">
        {data.rows.map(({ supply: s, halves }) => (
          <Link key={s.id} to={`/insumos/${s.id}`}>
            <div className="status-icon">
              <Icon name="sack" />
            </div>
            <div className="status-body">
              <div className="status-label">
                {s.name}
                {!s.active && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>Inativo</span>}
              </div>
              <div className="status-detail">
                {s.gramsPerSack ? `${formatKg(sacksToKg(halves, s.gramsPerSack))} · saco de ${formatKg(s.gramsPerSack / 1000)}` : 'Peso do saco não informado'}
              </div>
            </div>
            <span className={`badge ${halves < 0 ? 'badge-warn' : halves === 0 ? 'badge-neutral' : 'badge-ok'}`} data-testid={`stock-${s.name}`}>
              {formatSacks(halves)}
            </span>
            <Icon name="chevronRight" size={20} className="muted" />
          </Link>
        ))}
      </div>
      {adding ? (
        <NewSupplyForm onClose={() => setAdding(false)} />
      ) : (
        <button className="btn btn-outline btn-block" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Cadastrar outro produto
        </button>
      )}
    </>
  )
}

function NewSupplyForm({ onClose }: { onClose: () => void }) {
  const { farm } = useFarm()
  const navigate = useNavigate()
  const [key] = useState(newId)
  const [name, setName] = useState('')
  const [kg, setKg] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const grams = kg.trim() ? parseKgPerSack(kg) : null
      const s = await createSupply(db, farm.id, name, grams, key)
      navigate(`/insumos/${s.id}`)
    } catch (err) {
      setError(err instanceof SupplyError ? err.message : (err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack">
      <div className="status-label">Novo produto</div>
      <div className="field">
        <label className="label" htmlFor="sup-name">
          Nome
        </label>
        <input id="sup-name" className="input" maxLength={60} placeholder="Ex.: Ração proteinada" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="sup-kg">
          Peso do saco (kg)
        </label>
        <input id="sup-kg" className="input" inputMode="decimal" placeholder="Ex.: 25" value={kg} onChange={(e) => setKg(e.target.value)} />
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={!name.trim()}>
          <Icon name="check" /> Cadastrar
        </button>
      </div>
    </form>
  )
}

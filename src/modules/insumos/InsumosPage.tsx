import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { newId } from '../../core/ids'
import { formatMoney } from '../../core/money'
import { db } from '../../db/database'
import type { SupplyCategory } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { SupplyFields } from './SupplyFields'
import { fieldsToDetails, initialFields } from './supplyFieldsState'
import {
  CATEGORY_LABEL,
  categoryOf,
  createSupply,
  formatKg,
  formatQty,
  isLowStock,
  isMixture,
  mixtureUsing,
  recipeText,
  sacksToKg,
  supplyLedger,
  SupplyError,
  unitOf,
} from './supplies'
import { useSupplies } from './useSupplies'

const CATS: SupplyCategory[] = ['geral', 'herbicida', 'semente']
const INTRO: Record<SupplyCategory, string> = {
  geral: 'Estoque em sacos (aceita meio saco). Sal branco e mineral saem do estoque quando você lança “Mistura feita”; o consumo no cocho é lançado em sacos de mistura, por pasto.',
  herbicida: 'Herbicidas em litros ou kg. A compra entra no estoque (custo médio); a saída é lançada na aplicação, em Manejo de pastagens, com o custo por pasto.',
  semente: 'Sementes de capim em kg, por espécie e cultivar. A saída é lançada no plantio ou replantio, em Manejo de pastagens.',
}

export function InsumosPage() {
  const data = useSupplies()
  const [params, setParams] = useSearchParams()
  const cat = (CATS.find((c) => c === params.get('cat')) ?? 'geral') as SupplyCategory
  const [adding, setAdding] = useState(false)
  if (!data) return null
  const rows = data.rows.filter((r) => categoryOf(r.supply) === cat)
  const names = new Map(data.rows.map((r) => [r.supply.id, r.supply.name]))
  const count = (c: SupplyCategory) => data.rows.filter((r) => categoryOf(r.supply) === c).length
  return (
    <>
      <div className="chips chips-wrap" role="group" aria-label="Categoria">
        {CATS.map((c) => (
          <button
            key={c}
            type="button"
            className={`chip${cat === c ? ' active' : ''}`}
            aria-pressed={cat === c}
            onClick={() => {
              setAdding(false)
              setParams(c === 'geral' ? {} : { cat: c }, { replace: true })
            }}
          >
            {CATEGORY_LABEL[c]} ({count(c)})
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: '0 4px' }}>
        {INTRO[cat]}
      </p>
      {rows.length === 0 ? (
        <div className="card empty">
          <div className="status-icon">
            <Icon name="sack" size={28} />
          </div>
          <p className="muted">Nenhum produto em {CATEGORY_LABEL[cat].toLowerCase()}.</p>
        </div>
      ) : (
        <div className="card module-list" style={{ paddingTop: 6, paddingBottom: 6 }} data-testid="supplies">
          {rows.map(({ supply: s, halves }) => {
            const unit = unitOf(s)
            const mix = mixtureUsing(data.rows.map((r) => r.supply), s.id)
            const low = isLowStock(s, halves)
            const value = unit === 'saco' ? 0 : supplyLedger(data.movements, s.id).valueCents
            return (
              <Link key={s.id} to={`/insumos/${s.id}`}>
                <div className="status-icon">
                  <Icon name={cat === 'semente' ? 'pasture' : cat === 'herbicida' ? 'syringe' : 'sack'} />
                </div>
                <div className="status-body">
                  <div className="status-label">
                    {s.name}
                    {!s.active && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>Inativo</span>}
                    {low && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Estoque baixo</span>}
                  </div>
                  <div className="status-detail">
                    {cat === 'semente'
                      ? [[s.species, s.cultivar].filter(Boolean).join(' '), s.culturalValue ? `VC ${(s.culturalValue / 10).toLocaleString('pt-BR')}%` : '', value ? `em estoque ${formatMoney(value)}` : ''].filter(Boolean).join(' · ')
                      : cat === 'herbicida'
                        ? [s.activeIngredient, value ? `em estoque ${formatMoney(value)}` : ''].filter(Boolean).join(' · ') || 'Herbicida'
                        : isMixture(s)
                          ? `Vai para o cocho · ${recipeText(s, names)}`
                          : mix
                            ? `Entra na ${mix.name.toLocaleLowerCase('pt-BR')}${s.gramsPerSack ? ` · ${formatKg(sacksToKg(halves, s.gramsPerSack))}` : ''}`
                            : s.gramsPerSack
                              ? `${formatKg(sacksToKg(halves, s.gramsPerSack))} · saco de ${formatKg(s.gramsPerSack / 1000)}`
                              : 'Peso do saco não informado'}
                  </div>
                </div>
                <span className={`badge ${halves < 0 || low ? 'badge-warn' : halves === 0 ? 'badge-neutral' : 'badge-ok'}`} data-testid={`stock-${s.name}`}>
                  {formatQty(halves, unit)}
                </span>
                <Icon name="chevronRight" size={20} className="muted" />
              </Link>
            )
          })}
        </div>
      )}
      {adding ? (
        <NewSupplyForm key={cat} category={cat} onClose={() => setAdding(false)} />
      ) : (
        <button className="btn btn-outline btn-block" onClick={() => setAdding(true)} data-testid="add-supply">
          <Icon name="plus" /> {cat === 'herbicida' ? 'Cadastrar herbicida' : cat === 'semente' ? 'Cadastrar semente' : 'Cadastrar outro produto'}
        </button>
      )}
    </>
  )
}

function NewSupplyForm({ category, onClose }: { category: SupplyCategory; onClose: () => void }) {
  const { farm } = useFarm()
  const navigate = useNavigate()
  const [key] = useState(newId)
  const [name, setName] = useState('')
  const [fields, setFields] = useState(() => initialFields(undefined, category))
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const { gramsPerSack, details } = fieldsToDetails(fields)
      const s = await createSupply(db, farm.id, name, gramsPerSack, key, undefined, details)
      navigate(`/insumos/${s.id}`)
    } catch (err) {
      setError(err instanceof SupplyError ? err.message : (err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack" data-testid="new-supply">
      <div className="status-label">{category === 'herbicida' ? 'Novo herbicida' : category === 'semente' ? 'Nova semente' : 'Novo produto'}</div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="sup-name">
          {category === 'geral' ? 'Nome' : 'Nome comercial'}
        </label>
        <input
          id="sup-name"
          className="input"
          maxLength={60}
          placeholder={category === 'herbicida' ? 'Ex.: Tordon' : category === 'semente' ? 'Ex.: Marandu (Sementes XYZ)' : 'Ex.: Ração proteinada'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <SupplyFields value={fields} onChange={setFields} />
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

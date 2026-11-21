import { useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { formatDay } from '../rebanho/herd'
import { CoverageBar } from './CoverageBar'
import { useVaccinations } from './useVaccinations'
import { lotLabel, STATUS_LABEL } from './vaccination'

type Filter = 'andamento' | 'completas' | 'todas'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'andamento', label: 'Em andamento' },
  { id: 'completas', label: 'Completas' },
  { id: 'todas', label: 'Todas' },
]

export function VacinacaoPage() {
  const data = useVaccinations()
  const [filter, setFilter] = useState<Filter>('andamento')
  if (!data) return null
  const match = (pending: number, f: Filter) => (f === 'andamento' ? pending > 0 : f === 'completas' ? pending === 0 : true)
  const rows = data.rows.filter((r) => match(r.cov.pending, filter))
  return (
    <>
      <Link to="/vacinacao/nova" className="btn btn-primary btn-block" data-testid="new-vaccination">
        <Icon name="syringe" /> Nova vacinação
      </Link>
      {data.rows.length > 0 && (
        <div className="chips chips-wrap" role="group" aria-label="Filtrar vacinações">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={`chip${filter === f.id ? ' active' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} ({data.rows.filter((r) => match(r.cov.pending, f.id)).length})
            </button>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="card empty">
          <div className="status-icon">
            <Icon name="syringe" size={28} />
          </div>
          <p className="muted">{data.rows.length === 0 ? 'Nenhuma vacinação registrada.' : 'Nenhuma vacinação neste filtro.'}</p>
        </div>
      ) : (
        <div className="card pasture-list" data-testid="vaccination-list">
          {rows.map(({ v, cov, pasture }) => (
            <Link key={v.id} to={`/vacinacao/${v.id}`} className="vacc-item" data-testid="vaccination-item">
              <span className="vacc-head">
                <span className="pasture-name">{v.vaccine}</span>
                <span className={`badge ${cov.status === 'completa' ? 'badge-ok' : cov.status === 'parcial' ? 'badge-gold' : 'badge-neutral'}`}>{STATUS_LABEL[cov.status]}</span>
              </span>
              <span className="pasture-area">{lotLabel(pasture?.name ?? 'pasto removido', v.lot)}</span>
              <CoverageBar cov={cov} compact />
              {v.nextDate && !v.followUpId && <span className="vacc-next">Próxima vacinação: {formatDay(v.nextDate)}</span>}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

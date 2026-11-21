import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { useBalances, usePastures, usePendingTasks } from '../rebanho/useHerd'
import { buildPastureRows, filterPastures, FILTERS, matchesFilter, summarizePastures, type PastureFilter } from './pastureList'
import { formatArea } from './pastures'

const n = (v: number) => v.toLocaleString('pt-BR')

export function PastosPage() {
  const pastures = usePastures()
  const { balances } = useBalances()
  const pending = usePendingTasks()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PastureFilter>('todos')
  const rows = useMemo(() => (pastures && pending ? buildPastureRows(pastures, balances, pending) : []), [pastures, pending, balances])
  if (!pastures || !pending) return null
  const summary = summarizePastures(rows)
  const shown = filterPastures(rows, query, filter)

  return (
    <>
      <div className="pastos-head">
        <h2 className="section-title" style={{ margin: 0 }}>
          Resumo
        </h2>
        <Link to="/pastos/novo" className="btn btn-gold btn-compact" data-testid="new-pasture">
          <Icon name="plus" size={20} /> Novo pasto
        </Link>
      </div>

      {pastures.length === 0 ? (
        <div className="card empty">
          <div className="status-icon">
            <Icon name="pasture" size={28} />
          </div>
          <p className="muted">Nenhum pasto cadastrado.</p>
        </div>
      ) : (
        <>
          <div className="pastos-summary" data-testid="pastos-summary">
            <div>
              <span className="ps-value">{n(summary.total)}</span>
              <span className="ps-label">pastos</span>
            </div>
            <div>
              <span className="ps-value">{summary.hectares.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</span>
              <span className="ps-label">hectares</span>
              {summary.withoutArea > 0 && <span className="ps-note">{summary.withoutArea} sem área</span>}
            </div>
            <div>
              <span className="ps-value">{n(summary.occupied)}</span>
              <span className="ps-label">ocupados</span>
            </div>
            <div>
              <span className="ps-value">{n(summary.empty)}</span>
              <span className="ps-label">vazios</span>
            </div>
          </div>

          <div className="search-box">
            <Icon name="search" size={20} className="muted" />
            <input
              className="search-input"
              type="search"
              inputMode="search"
              placeholder="Pesquisar pasto"
              aria-label="Pesquisar pasto pelo nome"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="chips chips-wrap" role="group" aria-label="Filtrar pastos">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={`chip${filter === f.id ? ' active' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} ({rows.filter((r) => matchesFilter(r, f.id)).length})
              </button>
            ))}
          </div>
          <p className="muted pastos-count" data-testid="pastos-count">
            {shown.length === 1 ? '1 pasto' : `${n(shown.length)} pastos`}
            {query.trim() || filter !== 'todos' ? ` de ${n(rows.length)}` : ''}
          </p>

          {shown.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                Nenhum pasto encontrado{query.trim() ? ` com "${query.trim()}"` : ''} neste filtro.
              </p>
            </div>
          ) : (
            <div className="card pasture-list" data-testid="pasture-list">
              {shown.map((r) => (
                <div key={r.pasture.id} className="pasture-item" data-testid="pasture-item">
                  <Link to={`/pastos/${r.pasture.id}`} className="pasture-main">
                    <span className="status-icon">
                      <Icon name="pasture" />
                    </span>
                    <span className="pasture-info">
                      <span className="pasture-name">{r.pasture.name}</span>
                      <span className="pasture-area">{r.pasture.areaHa === null ? 'Área não informada' : formatArea(r.pasture.areaHa)}</span>
                    </span>
                    <span className={`pasture-heads${r.animals > 0 ? '' : ' is-empty'}`} aria-label={`${r.animals} cabeças`}>
                      <span className="heads-n">{n(r.animals)}</span>
                      <span className="heads-u">cab.</span>
                    </span>
                    <Icon name="chevronRight" size={20} className="muted pasture-chev" />
                  </Link>
                  {r.hasPending && (
                    <div className="pasture-flags">
                      {r.specText && (
                        <Link to={`/rebanho/movimentar/especificacao?pasto=${r.pasture.id}`} className="flag flag-warn" data-testid="flag-spec">
                          <Icon name="list" size={16} />
                          <span>
                            <strong>Especificar:</strong> {r.specText}
                          </span>
                        </Link>
                      )}
                      {r.tasks > 0 && (
                        <Link to={`/pastos/${r.pasture.id}`} className="flag flag-gold" data-testid="flag-tasks">
                          <Icon name="clipboard" size={16} />
                          <span>{r.tasks === 1 ? '1 serviço pendente' : `${r.tasks} serviços pendentes`}</span>
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}

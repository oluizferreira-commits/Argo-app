import { Fragment } from 'react'
import { Link } from 'react-router'
import { moduleById } from '../../app/modules'
import { Icon } from '../../components/Icon'
import { maskCpf } from '../../domain/pix'
import { useFarm } from '../fazendas/FarmContext'

const GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Vendas', ids: ['vendas', 'vendas-arroba', 'vendas-lote', 'clientes'] },
  { title: 'Recebimentos', ids: ['contas-receber', 'pagamentos'] },
  { title: 'Reserva', ids: ['reserva'] },
]

/** Aba Financeiro: dados do responsável no topo e os módulos agrupados. */
export function FinanceiroPage() {
  const { farm } = useFarm()
  const pending = !farm.responsibleCpf || !farm.pixKey
  return (
    <>
      <Link to="/financeiro/dados" className="card list-link" style={{ padding: 18 }} data-testid="fin-dados">
        <div className="status-icon">
          <Icon name="user" />
        </div>
        <div className="status-body">
          <div className="status-label">Dados do responsável</div>
          <div className="status-detail">
            {farm.responsible || 'Nome não informado'} · CPF {farm.responsibleCpf ? maskCpf(farm.responsibleCpf) : 'não informado'}
          </div>
          <div className="status-detail">{farm.pixKey ? 'Chave Pix cadastrada' : 'Chave Pix não cadastrada'}</div>
        </div>
        {pending ? <span className="badge badge-warn">Completar</span> : null}
        <Icon name="chevronRight" size={20} className="muted" />
      </Link>
      {GROUPS.map((g) => (
        <Fragment key={g.title}>
          <h2 className="section-title">{g.title}</h2>
          <div className="card module-list" style={{ paddingTop: 6, paddingBottom: 6 }}>
            {g.ids
              .map((id) => moduleById(id))
              .filter((m) => m !== undefined)
              .map((m) => (
                <Link key={m.id} to={m.path}>
                  <div className="status-icon">
                    <Icon name={m.icon} />
                  </div>
                  <div className="status-body">
                    <div className="status-label">{m.title}</div>
                    <div className="status-detail">{m.description}</div>
                  </div>
                  <Icon name="chevronRight" size={20} className="muted" />
                </Link>
              ))}
            {g.title === 'Vendas' && (
              <Link to="/relatorios?r=vendas" data-testid="fin-sales-report">
                <div className="status-icon">
                  <Icon name="chart" />
                </div>
                <div className="status-body">
                  <div className="status-label">Relatório de vendas</div>
                  <div className="status-detail">Mensal ou anual (mês a mês), por cliente · PDF</div>
                </div>
                <Icon name="chevronRight" size={20} className="muted" />
              </Link>
            )}
          </div>
        </Fragment>
      ))}
    </>
  )
}

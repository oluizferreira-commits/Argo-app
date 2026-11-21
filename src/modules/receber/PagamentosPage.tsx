import { Link } from 'react-router'
import { formatMoney } from '../../core/money'
import { Icon } from '../../components/Icon'
import { formatDay } from '../rebanho/herd'
import { formatSaleNumber } from '../vendas/sales'
import { METHOD_LABELS } from './receivables'
import { useReceivables } from './useReceivables'

export function PagamentosPage() {
  const r = useReceivables()
  if (!r) return null
  const list = [...r.payments].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const total = list.filter((p) => p.status === 'ativo').reduce((a, p) => a + p.amountCents, 0)
  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>Total recebido</p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 36 }}>
          {formatMoney(total)}
        </div>
        <p>{list.filter((p) => p.status === 'ativo').length} recebimento(s)</p>
      </section>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {list.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0' }}>
            Nenhum recebimento registrado.
          </p>
        ) : (
          list.map((p) => {
            const sale = r.sales.get(p.saleId)
            return (
              <Link key={p.id} to={`/vendas/${p.saleId}`} className={`list-link${p.status === 'estornado' ? ' reversed' : ''}`}>
                <div className="status-icon">
                  <Icon name="cash" />
                </div>
                <div className="status-body">
                  <div className="status-label">
                    {r.clients.get(p.clientId)?.name ?? '—'}
                    {p.status === 'estornado' && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Estornado</span>}
                  </div>
                  <div className="status-detail">
                    {formatDay(p.date)} · {METHOD_LABELS[p.method]}
                    {sale ? ` · venda nº ${formatSaleNumber(sale.number)}` : ''}
                  </div>
                </div>
                <span className="num">{formatMoney(p.amountCents)}</span>
              </Link>
            )
          })
        )}
      </div>
    </>
  )
}

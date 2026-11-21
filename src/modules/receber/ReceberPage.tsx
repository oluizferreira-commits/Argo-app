import { useState } from 'react'
import { Link } from 'react-router'
import { formatMoney } from '../../core/money'
import { Icon } from '../../components/Icon'
import { formatDay } from '../rebanho/herd'
import { formatSaleNumber } from '../vendas/sales'
import { STATUS_BADGE, STATUS_LABEL } from './receivables'
import { useReceivables } from './useReceivables'

export function ReceberPage() {
  const r = useReceivables()
  const [client, setClient] = useState('')
  if (!r) return null
  const list = r.open.filter((i) => !client || i.sale.clientId === client)
  const clients = [...new Map(r.open.map((i) => [i.sale.clientId, i.client?.name ?? '—'])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>A receber</p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 36 }} data-testid="total-open">
          {formatMoney(r.openCents)}
        </div>
        <p>
          Vencido: <strong style={{ color: r.overdueCents ? '#f2b4a8' : 'inherit' }} data-testid="total-overdue">{formatMoney(r.overdueCents)}</strong> · Recebido no mês:{' '}
          {formatMoney(r.receivedThisMonth)}
        </p>
      </section>

      {r.overdueCents > 0 && (
        <div className="notice notice-warn" role="alert">
          <Icon name="alert" />
          <div>
            Há <strong>{r.open.filter((i) => i.status === 'vencida').length} parcela(s) vencida(s)</strong> somando {formatMoney(r.overdueCents)}.
          </div>
        </div>
      )}

      {clients.length > 1 && (
        <select className="input" aria-label="Filtrar por cliente" value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      )}

      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="open-list">
        {list.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0' }}>
            Nada a receber. Todas as vendas estão quitadas.
          </p>
        ) : (
          list.map((i) => (
            <Link key={`${i.sale.id}-${i.index}`} to={`/vendas/${i.sale.id}`} className="list-link">
              <div className="status-body">
                <div className="status-label">{i.client?.name ?? '—'}</div>
                <div className="status-detail">
                  Venda nº {formatSaleNumber(i.sale.number)}
                  {i.sale.installments.length > 1 ? ` · parcela ${i.index + 1}/${i.sale.installments.length}` : ''} · vence {formatDay(i.due)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num">{formatMoney(i.openCents)}</div>
                <span className={`badge ${STATUS_BADGE[i.status]}`}>{STATUS_LABEL[i.status]}</span>
              </div>
            </Link>
          ))
        )}
      </div>

      <Link to="/pagamentos" className="btn btn-outline btn-block">
        <Icon name="list" /> Histórico de recebimentos
      </Link>
    </>
  )
}

import { Link } from 'react-router'
import { formatMoney } from '../../core/money'
import type { Sale } from '../../db/types'
import { Icon } from '../../components/Icon'
import { formatDay } from '../rebanho/herd'
import { formatSaleNumber } from './sales'

export function SaleRow({ sale, clientName }: { sale: Sale; clientName?: string }) {
  const heads = sale.items.reduce((a, i) => a + i.quantity, 0)
  return (
    <Link to={`/vendas/${sale.id}`} className={`list-link${sale.status === 'cancelada' ? ' reversed' : ''}`}>
      <div className="status-icon">
        <Icon name={sale.mode === 'arroba' ? 'scale' : 'tag'} />
      </div>
      <div className="status-body">
        <div className="status-label">
          Nº {formatSaleNumber(sale.number)}
          {clientName ? ` · ${clientName}` : ''}
          {sale.status === 'cancelada' && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Cancelada</span>}
        </div>
        <div className="status-detail">
          {formatDay(sale.date)} · {heads} cab. · {sale.mode === 'arroba' ? 'por arroba' : 'por cabeça'}
        </div>
      </div>
      <span className="num" style={{ whiteSpace: 'nowrap' }}>
        {formatMoney(sale.totalCents)}
      </span>
    </Link>
  )
}

import { Link } from 'react-router'
import { formatMoney } from '../../core/money'
import { Icon } from '../../components/Icon'
import { SaleRow } from './SaleRow'
import { useClients, useSales } from './useSales'

export function VendasPage() {
  const sales = useSales()
  const clients = useClients()
  if (!sales || !clients) return null
  const names = new Map(clients.map((c) => [c.id, c.name]))
  const active = sales.filter((s) => s.status === 'ativa')
  const total = active.reduce((a, s) => a + s.totalCents, 0)
  const heads = active.reduce((a, s) => a + s.items.reduce((x, i) => x + i.quantity, 0), 0)

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>Total vendido</p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 36 }}>
          {formatMoney(total)}
        </div>
        <p>
          {active.length} venda(s) · {heads} cabeça(s)
        </p>
      </section>
      <div className="row">
        <Link to="/vendas/nova/arroba" className="btn btn-gold" style={{ flex: 1 }}>
          <Icon name="scale" /> Por arroba
        </Link>
        <Link to="/vendas/nova/cabeca" className="btn btn-gold" style={{ flex: 1 }}>
          <Icon name="tag" /> Por cabeça
        </Link>
      </div>
      <Link to="/clientes" className="btn btn-outline btn-block">
        <Icon name="people" /> Clientes
      </Link>
      <h2 className="section-title">Vendas</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {sales.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0' }}>
            Nenhuma venda registrada.
          </p>
        ) : (
          sales.map((s) => <SaleRow key={s.id} sale={s} clientName={names.get(s.clientId)} />)
        )}
      </div>
    </>
  )
}

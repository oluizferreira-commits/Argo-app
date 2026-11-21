import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router'
import { formatMoney } from '../../core/money'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { SaleRow } from '../vendas/SaleRow'

export function ClientePage() {
  const { id = '' } = useParams()
  const { farm } = useFarm()
  const client = useLiveQuery(() => db.clients.get(id), [id])
  const sales = useLiveQuery(async () => (await db.sales.where('clientId').equals(id).toArray()).sort((a, b) => b.number - a.number), [id])
  if (client === undefined || !sales) return null
  if (!client || client.farmId !== farm.id) return <div className="card empty">Cliente não encontrado.</div>
  const active = sales.filter((s) => s.status === 'ativa')
  const total = active.reduce((a, s) => a + s.totalCents, 0)

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <h1 style={{ fontSize: 24 }}>{client.name}</h1>
        <p>{[client.city, client.phone].filter(Boolean).join(' · ') || 'Sem dados de contato'}</p>
        <p style={{ marginTop: 12 }}>
          {active.length} compra(s) · <strong style={{ color: 'var(--gold-300)' }}>{formatMoney(total)}</strong>
        </p>
      </section>
      <Link to={`/clientes/${id}/editar`} className="btn btn-outline btn-block">
        <Icon name="edit" /> Editar cliente
      </Link>
      <h2 className="section-title">Compras</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {sales.length === 0 ? <p className="muted" style={{ padding: '14px 0' }}>Nenhuma compra registrada.</p> : sales.map((s) => <SaleRow key={s.id} sale={s} />)}
      </div>
    </>
  )
}

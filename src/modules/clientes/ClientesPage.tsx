import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { useClients } from '../vendas/useSales'

export function ClientesPage() {
  const clients = useClients()
  if (!clients) return null
  return (
    <>
      <Link to="/clientes/novo" className="btn btn-gold btn-block">
        <Icon name="plus" /> Novo cliente
      </Link>
      {clients.length === 0 ? (
        <div className="card empty">
          <div className="status-icon">
            <Icon name="people" size={28} />
          </div>
          <p className="muted">Nenhum cliente cadastrado.</p>
        </div>
      ) : (
        <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {clients.map((c) => (
            <Link key={c.id} to={`/clientes/${c.id}`} className="list-link">
              <div className="status-icon">
                <Icon name="people" />
              </div>
              <div className="status-body">
                <div className="status-label">{c.name}</div>
                <div className="status-detail">{[c.city, c.phone].filter(Boolean).join(' · ') || '—'}</div>
              </div>
              <Icon name="chevronRight" size={20} className="muted" />
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

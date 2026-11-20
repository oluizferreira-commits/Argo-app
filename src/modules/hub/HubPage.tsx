import { Link } from 'react-router'
import { MODULES } from '../../app/modules'
import { Icon } from '../../components/Icon'

/** Lista de módulos (aba "Financeiro" e aba "Mais"). */
export function HubPage({ ids, intro }: { ids?: string[]; intro: string }) {
  const list = ids ? MODULES.filter((m) => ids.includes(m.id)) : MODULES.filter((m) => m.id !== 'dashboard')
  return (
    <>
      <p className="muted" style={{ margin: '0 4px' }}>
        {intro}
      </p>
      <div className="card module-list" style={{ paddingTop: 6, paddingBottom: 6 }}>
        {list.map((m) => (
          <Link key={m.id} to={m.path}>
            <div className="status-icon">
              <Icon name={m.icon} />
            </div>
            <div className="status-body">
              <div className="status-label">{m.title}</div>
              <div className="status-detail">{m.description}</div>
            </div>
            {m.status === 'planejado' ? <span className="badge badge-gold">Em breve</span> : null}
            <Icon name="chevronRight" size={20} className="muted" />
          </Link>
        ))}
      </div>
    </>
  )
}

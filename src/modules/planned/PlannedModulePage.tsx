import { Link } from 'react-router'
import type { ModuleDef } from '../../app/modules'
import { Icon } from '../../components/Icon'

/**
 * Página exibida para módulos ainda não implementados.
 * Mostra claramente que o módulo está planejado — sem telas ou dados fictícios.
 */
export function PlannedModulePage({ module: m }: { module: ModuleDef }) {
  return (
    <div className="card empty">
      <div className="status-icon">
        <Icon name={m.icon} size={28} />
      </div>
      <h2 style={{ fontSize: 22 }}>{m.title}</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        {m.description}
      </p>
      <p style={{ marginTop: 16 }}>
        <span className="badge badge-gold">
          <Icon name="clock" size={14} /> Módulo planejado{m.stage ? ` · Etapa ${m.stage}` : ''}
        </span>
      </p>
      <p className="muted" style={{ marginTop: 16 }}>
        Este módulo ainda não foi desenvolvido. A estrutura de dados, histórico e backup já está preparada para recebê-lo.
      </p>
      <Link to="/" className="btn btn-outline btn-block" style={{ marginTop: 20 }}>
        Voltar ao painel
      </Link>
    </div>
  )
}

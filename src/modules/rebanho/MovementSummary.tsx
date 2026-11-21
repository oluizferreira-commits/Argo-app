import { Link } from 'react-router'
import type { Movement, Pasture } from '../../db/types'
import { MOVEMENT_INFO } from '../../domain/movements'
import { Icon } from '../../components/Icon'
import { describeMovement } from './describe'
import { formatDay } from './herd'

export function MovementRow({ m, pastures }: { m: Movement; pastures: Map<string, Pasture> }) {
  const info = MOVEMENT_INFO[m.type]
  return (
    <Link to={`/rebanho/movimentacao/${m.id}`} className={`list-link${m.reversedBy ? ' reversed' : ''}`}>
      <div className="status-icon">
        <Icon name={info.icon} />
      </div>
      <div className="status-body">
        <div className="status-label">
          {info.label}
          {m.reversedBy && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Estornada</span>}
        </div>
        <div className="status-detail">{describeMovement(m, pastures)}</div>
      </div>
      <div className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
        {formatDay(m.date)}
      </div>
    </Link>
  )
}

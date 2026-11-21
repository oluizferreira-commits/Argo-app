import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { pastureTotal } from '../rebanho/herd'
import { useBalances, usePastures } from '../rebanho/useHerd'
import { formatArea } from './pastures'

export function PastosPage() {
  const pastures = usePastures()
  const { balances } = useBalances()
  const pending = useLiveQuery(async () => {
    const tasks = await db.pastureTasks.toArray()
    const map = new Map<string, number>()
    for (const t of tasks) if (t.deletedAt === null && !t.done) map.set(t.pastureId, (map.get(t.pastureId) ?? 0) + 1)
    return map
  })
  if (!pastures || !pending) return null

  return (
    <>
      <Link to="/pastos/novo" className="btn btn-gold btn-block">
        <Icon name="plus" /> Novo pasto
      </Link>
      {pastures.length === 0 ? (
        <div className="card empty">
          <div className="status-icon">
            <Icon name="pasture" size={28} />
          </div>
          <p className="muted">Nenhum pasto cadastrado.</p>
        </div>
      ) : (
        <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {pastures.map((p) => {
            const n = pending.get(p.id) ?? 0
            return (
              <Link key={p.id} to={`/pastos/${p.id}`} className="list-link">
                <div className="status-icon">
                  <Icon name="pasture" />
                </div>
                <div className="status-body">
                  <div className="status-label">{p.name}</div>
                  <div className="status-detail">
                    {formatArea(p.areaHa)}
                    {n > 0 && <span className="badge badge-warn" style={{ marginLeft: 8 }}>{n} serviço(s)</span>}
                  </div>
                </div>
                <span className="num">{pastureTotal(balances, p.id).toLocaleString('pt-BR')} cab.</span>
                <Icon name="chevronRight" size={20} className="muted" />
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}

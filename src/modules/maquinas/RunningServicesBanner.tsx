import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { formatDuration, openSessions, sessionSeconds } from './machines'
import { useNow } from './useMaquinas'

/** Serviços de máquina em andamento (recuperados do aparelho ao reabrir o app). */
export function RunningServicesBanner() {
  const { farm } = useFarm()
  const data = useLiveQuery(async () => {
    const sessions = openSessions(await db.machineSessions.where('farmId').equals(farm.id).toArray())
    const names = new Map((await db.equipments.where('farmId').equals(farm.id).toArray()).map((e) => [e.id, e.name]))
    return { sessions, names }
  }, [farm.id])
  const now = useNow(Boolean(data?.sessions.length))
  if (!data || data.sessions.length === 0) return null
  return (
    <Link to={`/maquinas/servico/${data.sessions[0].serviceId}`} className="notice notice-ok running-banner" style={{ textDecoration: 'none' }} data-testid="dash-running">
      <Icon name="clock" />
      <div style={{ flex: 1 }}>
        <strong>Serviço em andamento</strong>
        {data.sessions.map((s) => (
          <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              {data.names.get(s.equipmentId)}
              {s.status === 'pausada' ? ' (pausado)' : ''}
            </span>
            <span className="num">{formatDuration(sessionSeconds(s, now))}</span>
          </div>
        ))}
      </div>
    </Link>
  )
}

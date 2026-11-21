import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Icon } from '../../components/Icon'
import { equipmentStatus, formatDuration, formatMeterH, openSessions, sessionSeconds, STATUS_LABEL } from './machines'
import { MaquinaForm } from './MaquinaForm'
import { useMaquinas, useNow } from './useMaquinas'

export function MaquinasPage() {
  const data = useMaquinas()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const running = data ? openSessions(data.sessions) : []
  const now = useNow(running.length > 0)
  if (!data) return null
  const services = [...new Set(running.map((s) => s.serviceId))]
  return (
    <>
      {services.length > 0 && (
        <div className="stack" data-testid="running-services">
          {services.map((sid) => {
            const ss = running.filter((s) => s.serviceId === sid)
            return (
              <Link key={sid} to={`/maquinas/servico/${sid}`} className="notice notice-ok running-banner" style={{ textDecoration: 'none' }}>
                <Icon name="clock" />
                <div style={{ flex: 1 }}>
                  <strong>Serviço em andamento</strong>
                  {ss.map((s) => (
                    <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <span>
                        {data.equipmentById.get(s.equipmentId)?.name}
                        {s.status === 'pausada' ? ' (pausado)' : ''}
                      </span>
                      <span className="num">{formatDuration(sessionSeconds(s, now))}</span>
                    </div>
                  ))}
                </div>
              </Link>
            )
          })}
        </div>
      )}
      <Link to="/maquinas/servico/novo" className="btn btn-primary btn-block" data-testid="start-service">
        <Icon name="clock" /> Iniciar serviço (horímetro digital)
      </Link>
      {adding ? (
        <MaquinaForm current={null} onCancel={() => setAdding(false)} onDone={(e) => navigate(`/maquinas/${e.id}`)} />
      ) : (
        <button className="btn btn-outline btn-block" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Novo equipamento
        </button>
      )}
      <div className="card pasture-list" data-testid="equipments">
        {data.equipments.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0', margin: 0 }}>
            Nenhuma máquina cadastrada.
          </p>
        ) : (
          data.equipments.map((e) => {
            const st = equipmentStatus(e)
            const run = running.find((s) => s.equipmentId === e.id)
            return (
              <Link key={e.id} to={`/maquinas/${e.id}`} className="pasture-item pasture-main" style={{ gridTemplateColumns: '42px minmax(0,1fr) auto 20px' }}>
                <span className="status-icon">
                  <Icon name="fuel" />
                </span>
                <span className="pasture-info">
                  <span className="pasture-name">{e.name}</span>
                  <span className="pasture-area">
                    {[e.brand && e.model ? `${e.brand} ${e.model}` : e.type, e.responsibleId ? data.personById.get(e.responsibleId) : ''].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                <span className="pasture-heads">
                  <span className="heads-n" style={{ fontSize: 15 }}>
                    {e.meter === 'horimetro' ? formatMeterH(data.meterOf(e)) : e.meter === 'km' ? 'km' : '—'}
                  </span>
                  <span className={`badge ${run ? 'badge-gold' : st === 'ativo' ? 'badge-ok' : st === 'inativo' ? 'badge-neutral' : 'badge-warn'}`} style={{ marginTop: 4 }}>
                    {run ? 'Trabalhando' : STATUS_LABEL[st]}
                  </span>
                </span>
                <Icon name="chevronRight" size={20} className="muted pasture-chev" />
              </Link>
            )
          })
        )}
      </div>
    </>
  )
}

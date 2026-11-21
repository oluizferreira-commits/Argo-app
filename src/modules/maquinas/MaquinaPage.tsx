import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { formatMoney, parseDecimal } from '../../core/money'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { formatLiters, fuelLedger } from '../diesel/fuel'
import { useFarm } from '../fazendas/FarmContext'
import { verifyPin } from '../fazendas/farms'
import { typeLabel } from '../manejo/operations'
import { formatDay } from '../rebanho/herd'
import { absoluteReadings, adjustMeter, equipmentStatus, formatHoursMinutes, formatMeterH, sessionSeconds, STATUS_LABEL } from './machines'
import { MaquinaForm } from './MaquinaForm'
import { useMaquinas, useNow } from './useMaquinas'

export function MaquinaPage() {
  const { id } = useParams()
  const data = useMaquinas()
  const { farm } = useFarm()
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const eq = data?.equipmentById.get(id ?? '')
  const sessions = data && eq ? data.sessions.filter((s) => s.equipmentId === eq.id && s.deletedAt === null).sort((a, b) => b.startedAt.localeCompare(a.startedAt)) : []
  const running = sessions.find((s) => s.status === 'em-andamento' || s.status === 'pausada')
  const now = useNow(Boolean(running))
  if (!data) return null
  if (!eq) return <p className="muted">Máquina não encontrada.</p>
  const st = equipmentStatus(eq)
  const meter = data.meterOf(eq)
  const ops = data.operations.filter((o) => o.deletedAt === null && o.status === 'concluida' && o.equipments.some((l) => l.equipmentId === eq.id)).sort((a, b) => b.date.localeCompare(a.date))
  const ledger = fuelLedger(data.fuel)
  const costOf = new Map(ledger.lines.map((l) => [l.movement.id, l.costCents]))
  const fuelUses = data.fuel.filter((f) => f.equipmentId === eq.id && f.type === 'consumo' && f.status === 'ativo' && f.deletedAt === null).sort((a, b) => b.date.localeCompare(a.date))
  const dieselCl = fuelUses.reduce((a, f) => a - f.centiliters, 0)
  const dieselCents = fuelUses.reduce((a, f) => a + (costOf.get(f.id) ?? 0), 0)
  const workedSecs = sessions.filter((s) => s.status === 'encerrada').reduce((a, s) => a + sessionSeconds(s), 0)
  const people = [...new Set([eq.responsibleId, ...sessions.map((s) => s.responsibleId), ...fuelUses.map((f) => f.responsibleId)].filter((x): x is string => Boolean(x)))].map((r) => data.personById.get(r) ?? '—')
  const readings = absoluteReadings(eq, data.ctx).filter((r) => r.source.startsWith('Ajuste') || r.source === 'Horímetro inicial')

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>
          {eq.name}
          {(() => {
            // não repete marca/modelo que já estão no nome
            const bm = [eq.brand, eq.model].filter(Boolean).join(' ')
            const extra = [bm && !eq.name.toLowerCase().includes(bm.toLowerCase()) ? bm : '', eq.year ? String(eq.year) : ''].filter(Boolean).join(' ')
            return extra ? ` · ${extra}` : ''
          })()}
        </p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 34 }} data-testid="machine-meter">
          {eq.meter === 'horimetro' ? formatMeterH(meter) : eq.meter === 'km' ? 'Hodômetro (km)' : 'Sem medidor'}
        </div>
        <p>
          {STATUS_LABEL[st]}
          {eq.identification ? ` · ${eq.identification}` : ''}
          {eq.responsibleId ? ` · ${data.personById.get(eq.responsibleId)}` : ''}
        </p>
      </section>

      {running && (
        <Link to={`/maquinas/servico/${running.serviceId}`} className="notice notice-ok" style={{ textDecoration: 'none' }} data-testid="machine-running">
          <Icon name="clock" />
          <div>
            <strong>{running.status === 'pausada' ? 'Serviço pausado' : 'Trabalhando agora'}</strong> · {typeLabel(running.serviceType, running.customType)} · {formatHoursMinutes(sessionSeconds(running, now))}
          </div>
        </Link>
      )}

      {editing ? (
        <MaquinaForm current={eq} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
      ) : (
        <div className="row">
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditing(true)}>
            <Icon name="edit" /> Editar
          </button>
          {eq.meter === 'horimetro' && (
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setAdjusting(true)} data-testid="adjust-meter">
              <Icon name="refresh" /> Ajustar horímetro
            </button>
          )}
        </div>
      )}
      {adjusting && (
        <AdjustMeter
          needsPin={Boolean(farm.pinHash)}
          onClose={() => setAdjusting(false)}
          onSave={async (value, reason, pin) => {
            if (!(await verifyPin(farm, pin))) throw new Error('PIN da fazenda incorreto.')
            await adjustMeter(db, farm.id, eq.id, value, reason)
            setAdjusting(false)
          }}
        />
      )}

      <div className="kpi-grid">
        <div className="kpi">
          <span className="kpi-label">Horas no horímetro digital</span>
          <span className="kpi-value" data-testid="machine-hours">
            {formatHoursMinutes(workedSecs)}
          </span>
          <span className="kpi-detail">{sessions.filter((s) => s.status === 'encerrada').length} serviço(s)</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Diesel consumido</span>
          <span className="kpi-value">{formatLiters(dieselCl)}</span>
          <span className="kpi-detail">{formatMoney(dieselCents)}</span>
        </div>
      </div>
      {people.length > 0 && (
        <p className="muted" style={{ margin: '0 4px' }}>
          Responsáveis: {people.join(' · ')}
        </p>
      )}

      <h2 className="section-title">Histórico de utilização</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="machine-sessions">
        {sessions.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0', margin: 0 }}>
            Nenhum serviço pelo horímetro digital ainda.
          </p>
        ) : (
          sessions.slice(0, 30).map((s) => (
            <Link key={s.id} to={`/maquinas/servico/${s.serviceId}`} className={`task${s.status === 'cancelada' ? ' reversed' : ''}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="status-body">
                <div className="status-label">
                  {typeLabel(s.serviceType, s.customType)} · {s.pastureId ? data.pastureById.get(s.pastureId)?.name : s.location}
                </div>
                <div className="status-detail">
                  {new Date(s.startedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {formatHoursMinutes(sessionSeconds(s, now))}
                  {s.responsibleId ? ` · ${data.personById.get(s.responsibleId)}` : ''}
                  {s.status === 'cancelada' ? ' · cancelado' : s.status !== 'encerrada' ? ' · em andamento' : s.operationId ? ' · na operação' : ' · falta concluir a operação'}
                </div>
              </div>
              <Icon name="chevronRight" size={18} className="muted" />
            </Link>
          ))
        )}
      </div>

      <h2 className="section-title">Serviços realizados (operações)</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="machine-ops">
        {ops.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0', margin: 0 }}>
            Nenhuma operação de campo com esta máquina.
          </p>
        ) : (
          ops.map((o) => {
            const l = o.equipments.find((x) => x.equipmentId === eq.id)!
            return (
              <Link key={o.id} to={`/manejo/${o.id}`} className="task" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="status-body">
                  <div className="status-label">
                    {typeLabel(o.type, o.customType)} · {o.pastureId ? data.pastureById.get(o.pastureId)?.name : o.location}
                  </div>
                  <div className="status-detail">
                    {formatDay(o.date)} · {l.sessionSeconds != null ? formatHoursMinutes(l.sessionSeconds) : l.hoursTenths !== null ? `${(l.hoursTenths / 10).toLocaleString('pt-BR')} h` : 'sem horas'}
                    {l.dieselCl ? ` · ${formatLiters(l.dieselCl)} · ${formatMoney(l.dieselCents)}` : ''}
                  </div>
                </div>
                <Icon name="chevronRight" size={18} className="muted" />
              </Link>
            )
          })
        )}
      </div>

      {readings.length > 0 && (
        <>
          <h2 className="section-title">Horímetro: inicial e ajustes</h2>
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="meter-log">
            {readings.map((r) => (
              <div key={r.at + r.source} className="task">
                <div className="status-body">
                  <div className="status-label">{formatMeterH(r.value)}</div>
                  <div className="status-detail">
                    {new Date(r.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {r.source}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {eq.notes && (
        <div className="card">
          <p style={{ margin: 0 }}>{eq.notes}</p>
        </div>
      )}
    </>
  )
}

function AdjustMeter({ onSave, onClose, needsPin }: { onSave: (value: number, reason: string, pin: string) => Promise<void>; onClose: () => void; needsPin: boolean }) {
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="card stack" data-testid="adjust-meter-form">
      <div className="status-label">Ajustar horímetro</div>
      <p className="muted" style={{ margin: 0 }}>
        Use quando o horímetro do painel da máquina estiver diferente. Fica no histórico com o motivo.
      </p>
      <input className="input" inputMode="decimal" aria-label="Horímetro correto" placeholder="Horímetro correto (ex.: 1251,9)" value={value} onChange={(e) => setValue(e.target.value)} />
      <input className="input" aria-label="Motivo do ajuste" placeholder="Motivo (obrigatório)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      {needsPin && <input className="input" type="password" inputMode="numeric" aria-label="PIN" placeholder="PIN da fazenda" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}
      {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className="row">
        <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={async () => {
            setError(null)
            const v = parseDecimal(value, 2)
            if (v === null) return setError('Informe o horímetro (ex.: 1251,9).')
            try {
              await onSave(v, reason, pin)
            } catch (err) {
              setError((err as Error).message)
            }
          }}
        >
          Salvar ajuste
        </button>
      </div>
    </div>
  )
}

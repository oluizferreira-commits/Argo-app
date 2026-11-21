import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { FieldOperationType } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { verifyPin } from '../fazendas/farms'
import { OPERATION_TYPES, PASTURE_OPTIONAL, typeLabel } from '../manejo/operations'
import {
  adjustSessionTime,
  cancelSession,
  endSession,
  equipmentStatus,
  formatDuration,
  formatHoursMinutes,
  formatMeterH,
  openSessions,
  pauseSession,
  resumeSession,
  sessionSeconds,
  startService,
} from './machines'
import { useMaquinas, useNow } from './useMaquinas'

/** INICIAR SERVIÇO: máquinas, tipo de serviço, pasto/local e responsáveis. */
export function IniciarServicoPage() {
  const data = useMaquinas()
  const { farm } = useFarm()
  const navigate = useNavigate()
  const [key] = useState(newId)
  const [type, setType] = useState<FieldOperationType>('rocada')
  const [customType, setCustomType] = useState('')
  const [pastureId, setPastureId] = useState('')
  const [location, setLocation] = useState('')
  const [chosen, setChosen] = useState<Record<string, string>>({}) // equipmentId → responsável
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!data) return null
  const busy = new Set(openSessions(data.sessions).map((s) => s.equipmentId))
  const machines = data.equipments.filter((e) => ['ativo', 'parado'].includes(equipmentStatus(e)))
  const people = data.responsibles.filter((r) => r.deletedAt === null && r.active)
  const pastures = data.pastures.filter((p) => p.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const sid = await startService(
        db,
        farm.id,
        { serviceType: type, customType, pastureId: pastureId || null, location, machines: Object.entries(chosen).map(([equipmentId, r]) => ({ equipmentId, responsibleId: r || null })), notes },
        key,
      )
      navigate(`/maquinas/servico/${sid}`, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="stack" data-testid="start-form">
      <div className="card stack">
        <div className="label">Tipo de serviço</div>
        <div className="chips chips-wrap" role="group" aria-label="Tipo de serviço">
          {OPERATION_TYPES.map((t) => (
            <button type="button" key={t.id} className={`chip${type === t.id ? ' active' : ''}`} onClick={() => setType(t.id)}>
              {t.short}
            </button>
          ))}
        </div>
        {type === 'outra' && (
          <input className="input" aria-label="Qual serviço" placeholder="Qual serviço? Ex.: conserto de cerca" maxLength={60} value={customType} onChange={(e) => setCustomType(e.target.value)} />
        )}
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="sv-pasture">
            Pasto{PASTURE_OPTIONAL.includes(type) ? ' (ou informe o local)' : ''}
          </label>
          <select id="sv-pasture" className="input" value={pastureId} onChange={(e) => setPastureId(e.target.value)}>
            <option value="">{PASTURE_OPTIONAL.includes(type) ? 'Fora de pasto' : 'Escolha o pasto'}</option>
            {pastures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {!pastureId && PASTURE_OPTIONAL.includes(type) && (
          <input className="input" aria-label="Local" placeholder="Local (ex.: sede → Redenção)" maxLength={80} value={location} onChange={(e) => setLocation(e.target.value)} />
        )}
      </div>

      <h2 className="section-title">Máquinas</h2>
      <div className="card stack" data-testid="sv-machines">
        {machines.length === 0 && <p className="muted" style={{ margin: 0 }}>Nenhuma máquina ativa. Cadastre em Máquinas.</p>}
        {machines.map((m) => {
          const on = m.id in chosen
          return (
            <div key={m.id} className="op-line">
              <label className="row" style={{ gap: 10 }}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy.has(m.id)}
                  onChange={(e) => {
                    const next = { ...chosen }
                    if (e.target.checked) next[m.id] = m.responsibleId ?? ''
                    else delete next[m.id]
                    setChosen(next)
                  }}
                  style={{ width: 22, height: 22 }}
                  aria-label={`Usar ${m.name}`}
                />
                <span style={{ flex: 1 }}>
                  <strong>{m.name}</strong>
                  <span className="muted" style={{ display: 'block', fontSize: 14 }}>
                    {busy.has(m.id) ? 'Já está em outro serviço' : m.meter === 'horimetro' ? `Horímetro ${formatMeterH(data.meterOf(m))}` : 'Sem horímetro'}
                  </span>
                </span>
              </label>
              {on && (
                <select className="input" style={{ marginTop: 8 }} aria-label={`Responsável por ${m.name}`} value={chosen[m.id]} onChange={(e) => setChosen({ ...chosen, [m.id]: e.target.value })}>
                  <option value="">Responsável (opcional)</option>
                  {people.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )
        })}
      </div>
      <input className="input" aria-label="Observação" placeholder="Observação (opcional)" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-block btn-big" disabled={Object.keys(chosen).length === 0} data-testid="start-now">
        <Icon name="clock" /> INICIAR SERVIÇO
      </button>
    </form>
  )
}

/** Serviço em andamento: tempo de cada máquina (calculado pelos horários), pausar/retomar/encerrar. */
export function ServicoPage() {
  const { id } = useParams()
  const data = useMaquinas()
  const { farm } = useFarm()
  const sessions = data ? data.sessions.filter((s) => s.serviceId === id && s.deletedAt === null) : []
  const live = sessions.some((s) => s.status === 'em-andamento' || s.status === 'pausada')
  const now = useNow(live)
  const [msg, setMsg] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<string | null>(null)
  if (!data) return null
  if (sessions.length === 0) return <p className="muted">Serviço não encontrado.</p>
  const first = sessions[0]
  const place = first.pastureId ? (data.pastureById.get(first.pastureId)?.name ?? 'pasto') : first.location
  const ended = sessions.filter((s) => s.status === 'encerrada')
  const allDone = sessions.every((s) => s.status === 'encerrada' || s.status === 'cancelada')
  const linkedOp = sessions.find((s) => s.operationId)?.operationId
  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null)
    try {
      await fn()
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>
          {typeLabel(first.serviceType, first.customType)} · {place}
        </p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 34 }} data-testid="service-status">
          {live ? 'Em andamento' : linkedOp ? 'Lançado' : 'Encerrado'}
        </div>
        <p>Início {new Date(first.startedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
      </section>
      {msg && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{msg}</div>
        </div>
      )}
      <div className="stack" data-testid="service-machines">
        {sessions.map((s) => {
          const eq = data.equipmentById.get(s.equipmentId)
          const secs = sessionSeconds(s, now)
          const before = eq ? data.meterOf(eq) : null
          return (
            <div key={s.id} className="card stack" data-testid={`session-${eq?.name}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="status-label">{eq?.name}</div>
                  <div className="status-detail">{s.responsibleId ? data.personById.get(s.responsibleId) : 'Sem responsável'}</div>
                </div>
                <span className={`badge ${s.status === 'em-andamento' ? 'badge-gold' : s.status === 'pausada' ? 'badge-warn' : s.status === 'cancelada' ? 'badge-neutral' : 'badge-ok'}`}>
                  {s.status === 'em-andamento' ? 'Trabalhando' : s.status === 'pausada' ? 'Pausado' : s.status === 'cancelada' ? 'Cancelado' : 'Encerrado'}
                </span>
              </div>
              <div className="timer" data-testid="timer">
                {formatDuration(secs)}
              </div>
              {eq?.meter === 'horimetro' && before !== null && (
                <p className="muted" style={{ margin: 0 }} data-testid="session-meter">
                  {s.status === 'encerrada' ? `Horímetro atual ${formatMeterH(before)}` : `Horímetro ${formatMeterH(before)} + ${formatHoursMinutes(secs)}`}
                </p>
              )}
              {s.adjustReason && s.status === 'encerrada' && <p className="muted" style={{ margin: 0 }}>Tempo ajustado: {s.adjustReason}</p>}
              {s.status === 'em-andamento' && (
                <div className="row">
                  <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => act(() => pauseSession(db, s.id))} data-testid="pause">
                    Pausar
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => act(() => endSession(db, s.id))} data-testid="end">
                    ENCERRAR SERVIÇO
                  </button>
                </div>
              )}
              {s.status === 'pausada' && (
                <div className="row">
                  <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => act(() => resumeSession(db, s.id))} data-testid="resume">
                    Retomar
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => act(() => endSession(db, s.id))} data-testid="end">
                    ENCERRAR SERVIÇO
                  </button>
                </div>
              )}
              {s.status === 'encerrada' && !s.operationId && adjusting !== s.id && (
                <button className="btn btn-outline btn-block" onClick={() => setAdjusting(s.id)}>
                  <Icon name="edit" /> Ajustar tempo (com motivo)
                </button>
              )}
              {adjusting === s.id && (
                <AdjustTime
                  onCancel={() => setAdjusting(null)}
                  onSave={async (secsNew, reason, pin) => {
                    if (!(await verifyPin(farm, pin))) throw new Error('PIN da fazenda incorreto.')
                    await adjustSessionTime(db, s.id, secsNew, reason)
                    setAdjusting(null)
                  }}
                  onCancelSession={async (reason, pin) => {
                    if (!(await verifyPin(farm, pin))) throw new Error('PIN da fazenda incorreto.')
                    await cancelSession(db, s.id, reason)
                    setAdjusting(null)
                  }}
                  needsPin={Boolean(farm.pinHash)}
                />
              )}
            </div>
          )
        })}
      </div>
      {live && sessions.filter((s) => s.status !== 'encerrada' && s.status !== 'cancelada').length > 1 && (
        <button className="btn btn-outline btn-block" onClick={() => act(async () => { for (const s of sessions) if (s.status === 'em-andamento' || s.status === 'pausada') await endSession(db, s.id) })} data-testid="end-all">
          Encerrar todas as máquinas
        </button>
      )}
      {allDone && ended.length > 0 && !linkedOp && (
        <Link to={`/manejo/nova?servico=${id}`} className="btn btn-gold btn-block" data-testid="to-operation">
          <Icon name="check" /> Concluir a operação de campo (diesel, produtos, custos)
        </Link>
      )}
      {linkedOp && (
        <Link to={`/manejo/${linkedOp}`} className="btn btn-outline btn-block">
          Ver a operação de campo
        </Link>
      )}
      <p className="muted" style={{ margin: '0 4px', fontSize: 13 }}>
        O tempo é calculado pelos horários de início, pausas e fim gravados no aparelho: continua certo com o app fechado ou em segundo plano, e funciona sem internet.
      </p>
    </>
  )
}

function AdjustTime({
  onSave,
  onCancel,
  onCancelSession,
  needsPin,
}: {
  onSave: (seconds: number, reason: string, pin: string) => Promise<void>
  onCancel: () => void
  onCancelSession: (reason: string, pin: string) => Promise<void>
  needsPin: boolean
}) {
  const [h, setH] = useState('')
  const [m, setM] = useState('')
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <div className="stack" data-testid="adjust-time">
      <div className="row">
        <input className="input" inputMode="numeric" aria-label="Horas" placeholder="Horas" value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, ''))} />
        <input className="input" inputMode="numeric" aria-label="Minutos" placeholder="Minutos" value={m} onChange={(e) => setM(e.target.value.replace(/\D/g, '').slice(0, 2))} />
      </div>
      <input className="input" aria-label="Motivo" placeholder="Motivo (obrigatório)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      {needsPin && <input className="input" type="password" inputMode="numeric" aria-label="PIN" placeholder="PIN da fazenda" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}
      {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className="row">
        <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onCancel}>
          Voltar
        </button>
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => run(() => onSave(Number(h || 0) * 3600 + Number(m || 0) * 60, reason, pin))}>
          Salvar tempo
        </button>
      </div>
      <button type="button" className="btn btn-danger btn-block" onClick={() => run(() => onCancelSession(reason, pin))}>
        Cancelar esta sessão (lançada por engano)
      </button>
    </div>
  )
}

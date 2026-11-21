import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { formatDateTime } from '../../core/format'
import { newId } from '../../core/ids'
import { formatMoney, parseMoney } from '../../core/money'
import { db } from '../../db/database'
import type { Worker, WorkDay, WorkDayKind } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { formatDay, todayLocal } from '../rebanho/herd'
import { MONTHS } from '../relatorios/reports'
import { WorkerForm } from './DiaristasPage'
import { useDiaristas } from './useDiaristas'
import { clearDay, dayState, defaultKind, halfValue, KIND_LABEL, markDay, monthSummary, recordWorkerPayment, reverseWorkerPayment, setWorkerActive, workDayId, workerBalance, type DayState } from './workers'

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const SHORT: Partial<Record<DayState, string>> = { integral: '✓', meia: '½', falta: '✕', 'nao-marcado': '✕', 'falta-justificada': 'J', folga: 'F' }
const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split('-').map(Number)
  const t = new Date(Date.UTC(y, mo - 1 + d, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1].replace(/^./, (c) => c.toUpperCase())} de ${m.slice(0, 4)}`

export function DiaristaPage() {
  const { id } = useParams()
  const data = useDiaristas()
  const today = todayLocal()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  if (!data) return null
  const w = data.workers.find((x) => x.id === id)
  if (!w) return <p className="muted">Diarista não encontrado.</p>
  const byDate = new Map(data.days.filter((d) => d.workerId === w.id && d.deletedAt === null).map((d) => [d.date, d]))
  const sum = monthSummary(w, data.days, data.payments, month)
  const all = workerBalance(w, data.days, data.payments)
  const [y, mo] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const lead = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
  const payments = data.payments.filter((p) => p.workerId === w.id && p.deletedAt === null).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

  async function reverse(pid: string, amount: number) {
    const reason = window.prompt(`Estornar o pagamento de ${formatMoney(amount)}?\n\nInforme o motivo:`)
    if (reason === null) return
    try {
      await reverseWorkerPayment(db, pid, reason)
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>{w.name}</p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 32 }} data-testid="worker-balance">
          {formatMoney(all.balanceCents)}
        </div>
        <p>
          saldo a pagar · diária {formatMoney(w.dailyCents)} · meia {formatMoney(halfValue(w))}
        </p>
      </section>
      {msg && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{msg}</div>
        </div>
      )}

      <div className="card stack" data-testid="calendar">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-outline btn-icon" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <strong data-testid="cal-month">{monthLabel(month)}</strong>
          <button className="btn btn-outline btn-icon" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}>
            <Icon name="chevronRight" size={20} />
          </button>
        </div>
        <div className="cal-grid">
          {WEEK.map((d, i) => (
            <span key={i} className="cal-head">
              {d}
            </span>
          ))}
          {cells.map((date, i) => {
            if (!date) return <span key={`b${i}`} />
            const st = dayState(w, date, byDate.get(date), today)
            const disabled = (st === 'futuro' && date > today) || st === 'antes' // hoje pode ser marcado
            return (
              <button key={date} type="button" className={`cal-day st-${st}${date === today ? ' is-today' : ''}`} disabled={disabled} aria-label={`${formatDay(date)}: ${st}`} data-testid={`day-${date}`} onClick={() => setSel(date)}>
                <span className="cal-n">{Number(date.slice(8))}</span>
                <span className="cal-k">{SHORT[st] ?? ''}</span>
              </button>
            )
          })}
        </div>
        <div className="cal-legend">
          <span className="lg st-integral">✓ trabalhou</span>
          <span className="lg st-meia">½ meia</span>
          <span className="lg st-falta">✕ não trabalhou</span>
          <span className="lg st-domingo">domingo / futuro</span>
          <span className="lg st-folga">J justificada · F folga</span>
        </div>
      </div>

      <h2 className="section-title">Fechamento · {monthLabel(month)}</h2>
      <div className="card" data-testid="month-summary">
        <dl className="kv">
          <dt>Dias trabalhados</dt>
          <dd>{sum.daysWorked}</dd>
          <dt>Diárias integrais</dt>
          <dd>{sum.integral}</dd>
          <dt>Meias diárias</dt>
          <dd>{sum.half}</dd>
          <dt>Faltas</dt>
          <dd>{sum.absences}</dd>
          <dt>Faltas justificadas</dt>
          <dd>{sum.justified}</dd>
          <dt>Folgas</dt>
          <dd>{sum.dayOff}</dd>
          <dt>
            <strong>Valor devido</strong>
          </dt>
          <dd data-testid="sum-due">{formatMoney(sum.dueCents)}</dd>
          <dt>Pagamentos do mês</dt>
          <dd data-testid="sum-paid">{formatMoney(sum.paidCents)}</dd>
          <dt>
            <strong>Saldo do mês</strong>
          </dt>
          <dd data-testid="sum-balance" style={{ color: sum.balanceCents > 0 ? 'var(--warn)' : 'var(--ok)' }}>
            {formatMoney(sum.balanceCents)}
          </dd>
        </dl>
      </div>

      {paying ? (
        <PaymentForm worker={w} month={month} suggested={Math.max(0, sum.balanceCents)} onClose={() => setPaying(false)} />
      ) : (
        <button className="btn btn-gold btn-block" onClick={() => setPaying(true)} data-testid="pay">
          <Icon name="cash" /> Registrar pagamento
        </button>
      )}

      <h2 className="section-title">Pagamentos</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="payments">
        {payments.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0', margin: 0 }}>
            Nenhum pagamento.
          </p>
        ) : (
          payments.map((p) => (
            <div key={p.id} className={`task${p.status === 'estornado' ? ' reversed' : ''}`}>
              <div className="status-body">
                <div className="status-label">
                  {formatMoney(p.amountCents)} · {p.method}
                  {p.status === 'estornado' && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Estornado</span>}
                </div>
                <div className="status-detail">
                  {formatDay(p.date)} · referente a {monthLabel(p.refMonth)}
                  {p.notes ? ` · ${p.notes}` : ''}
                  {p.status === 'estornado' && p.reverseReason ? ` · estorno: ${p.reverseReason}` : ''}
                </div>
              </div>
              {p.status === 'ativo' && (
                <button className="btn btn-danger btn-icon" aria-label={`Estornar pagamento de ${formatMoney(p.amountCents)}`} onClick={() => reverse(p.id, p.amountCents)}>
                  <Icon name="undo" size={20} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {editing ? (
        <WorkerForm current={w} onClose={() => setEditing(false)} />
      ) : (
        <div className="row">
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditing(true)}>
            <Icon name="edit" /> Editar
          </button>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setWorkerActive(db, w.id, !w.active)}>
            {w.active ? 'Desativar' : 'Reativar'}
          </button>
        </div>
      )}

      {sel && <DaySheet worker={w} date={sel} day={byDate.get(sel)} onClose={() => setSel(null)} onError={setMsg} />}
    </>
  )
}

function DaySheet({ worker: w, date, day, onClose, onError }: { worker: Worker; date: string; day: WorkDay | undefined; onClose: () => void; onError: (m: string) => void }) {
  const { farm } = useFarm()
  const [notes, setNotes] = useState(day?.notes ?? '')
  const history = useLiveQuery(() => db.auditLog.where('[entity+entityId]').equals(['workDays', workDayId(w.id, date)]).toArray(), [w.id, date])
  const def = defaultKind(date)
  const options: WorkDayKind[] = [def, ...(['integral', 'meia', 'falta', 'falta-justificada', 'folga'] as const).filter((k) => k !== def)]
  const value = (k: WorkDayKind) => (k === 'integral' ? w.dailyCents : k === 'meia' ? halfValue(w) : 0)
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay()

  async function pick(k: WorkDayKind | null) {
    try {
      if (k) await markDay(db, farm.id, w.id, date, k, notes)
      else await clearDay(db, w.id, date)
      onClose()
    } catch (err) {
      onError((err as Error).message)
      onClose()
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Marcar ${formatDay(date)}`} onClick={(e) => e.stopPropagation()} data-testid="day-sheet">
        <div className="sheet-head">
          <strong>
            {formatDay(date)} · {['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][wd]}
          </strong>
          <button className="btn btn-outline btn-icon" aria-label="Fechar" onClick={onClose}>
            <Icon name="chevronLeft" size={20} />
          </button>
        </div>
        {wd === 0 && <p className="muted" style={{ margin: '0 0 8px' }}>Domingo: sem expediente. Marque só se ele trabalhou.</p>}
        <div className="stack" style={{ gap: 8 }}>
          {options.map((k, i) => (
            <button key={k} type="button" className={`btn ${i === 0 ? 'btn-primary' : 'btn-outline'} btn-block day-opt st-${k}${day?.kind === k ? ' current' : ''}`} onClick={() => void pick(k)} data-testid={`opt-${k}`}>
              {KIND_LABEL[k]}
              {value(k) ? ` · ${formatMoney(value(k))}` : ''}
              {day?.kind === k ? ' (atual)' : ''}
            </button>
          ))}
          <input className="input" aria-label="Observação do dia" placeholder="Observação (ex.: feriado, médico)" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {day && !day.operationId && (
            <button type="button" className="btn btn-outline btn-block" onClick={() => void pick(null)} data-testid="opt-clear">
              Desmarcar
            </button>
          )}
          {day?.operationId && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Esta diária está numa operação de campo.</p>}
        </div>
        {history && history.length > 1 && (
          <div style={{ marginTop: 10 }} data-testid="day-history">
            <div className="group-title">Alterações</div>
            {history
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((h) => {
                const after = h.after as WorkDay | null
                return (
                  <div key={h.id} className="cat-line">
                    <span>{formatDateTime(h.at)}</span>
                    <span>{h.action === 'delete' ? 'Desmarcado' : after ? KIND_LABEL[after.kind] : h.action}</span>
                  </div>
                )
              })}
          </div>
        )}
      </div>
    </div>
  )
}

function PaymentForm({ worker, month, suggested, onClose }: { worker: Worker; month: string; suggested: number; onClose: () => void }) {
  const { farm } = useFarm()
  const [key] = useState(newId)
  const [date, setDate] = useState(todayLocal)
  const [amount, setAmount] = useState(suggested ? (suggested / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }).replace(/\./g, '') : '')
  const [method, setMethod] = useState('Pix')
  const [ref, setRef] = useState(month)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await recordWorkerPayment(db, farm.id, { workerId: worker.id, date, amountCents: parseMoney(amount) ?? 0, method, refMonth: ref, notes }, key)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack" data-testid="payment-form">
      <div className="status-label">Pagamento · {worker.name}</div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="wp-amount">
            Valor pago
          </label>
          <input id="wp-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="wp-date">
            Data
          </label>
          <input id="wp-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {['Pix', 'Dinheiro', 'Transferência'].map((m) => (
          <button type="button" key={m} className={`chip${method === m ? ' active' : ''}`} onClick={() => setMethod(m)}>
            {m}
          </button>
        ))}
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="wp-ref">
          Referente ao mês
        </label>
        <input id="wp-ref" type="month" className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
      </div>
      <input className="input" aria-label="Observação do pagamento" placeholder="Observação (ex.: adiantamento)" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} data-testid="save-payment">
          <Icon name="check" /> Registrar
        </button>
      </div>
    </form>
  )
}

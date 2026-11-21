import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { newId } from '../../core/ids'
import { formatMoney, parseMoney } from '../../core/money'
import { db } from '../../db/database'
import type { Worker } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { verifyPin } from '../fazendas/farms'
import { todayLocal } from '../rebanho/herd'
import { MONTHS } from '../relatorios/reports'
import { useDiaristas } from './useDiaristas'
import { createWorker, halfValue, monthSummary, updateWorker, WorkerError, workerBalance } from './workers'

export function DiaristasPage() {
  const data = useDiaristas()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  if (!data) return null
  const month = todayLocal().slice(0, 7)
  const monthName = MONTHS[Number(month.slice(5)) - 1]
  return (
    <>
      <p className="muted" style={{ margin: '0 4px' }}>
        Marque os dias no calendário de cada trabalhador. O app calcula o valor devido; o pagamento é que sai do caixa.
      </p>
      {adding ? (
        <WorkerForm current={null} onClose={() => setAdding(false)} onDone={(w) => navigate(`/diaristas/${w.id}`)} />
      ) : (
        <button className="btn btn-primary btn-block" onClick={() => setAdding(true)} data-testid="new-worker">
          <Icon name="plus" /> Novo diarista
        </button>
      )}
      <div className="card pasture-list" data-testid="workers">
        {data.workers.length === 0 ? (
          <p className="muted" style={{ margin: '12px 0' }}>
            Nenhum diarista cadastrado.
          </p>
        ) : (
          data.workers.map((w) => {
            const m = monthSummary(w, data.days, data.payments, month)
            const all = workerBalance(w, data.days, data.payments)
            return (
              <Link key={w.id} to={`/diaristas/${w.id}`} className={`vacc-item${w.active ? '' : ' reversed'}`} data-testid="worker-item">
                <span className="vacc-head">
                  <span className="pasture-name">{w.name}</span>
                  <strong>{formatMoney(all.balanceCents)}</strong>
                </span>
                <span className="pasture-area">
                  Diária {formatMoney(w.dailyCents)} · meia {formatMoney(halfValue(w))}
                  {!w.active ? ' · inativo' : ''}
                </span>
                <span className="vacc-next">
                  {monthName}: {m.daysWorked} dia(s) · devido {formatMoney(m.dueCents)} · pago {formatMoney(m.paidCents)}
                </span>
              </Link>
            )
          })
        )}
      </div>
      <p className="muted" style={{ margin: '0 4px', fontSize: 13 }}>
        Valor à direita = saldo a pagar (todos os meses).
      </p>
      <Link to="/relatorios?r=diaristas" className="btn btn-outline btn-block" data-testid="workers-report">
        <Icon name="chart" /> Relatório de diaristas (mês ou ano)
      </Link>
    </>
  )
}

export function WorkerForm({ current, onClose, onDone }: { current: Worker | null; onClose: () => void; onDone?: (w: Worker) => void }) {
  const { farm } = useFarm()
  const [key] = useState(newId)
  const m2 = (c: number | null | undefined) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }).replace(/\./g, ''))
  const [name, setName] = useState(current?.name ?? '')
  const [daily, setDaily] = useState(m2(current?.dailyCents))
  const [half, setHalf] = useState(current?.halfCents != null ? m2(current.halfCents) : '')
  const [halfReason, setHalfReason] = useState(current?.halfReason ?? '')
  const [start, setStart] = useState(current?.startDate ?? todayLocal())
  const [notes, setNotes] = useState(current?.notes ?? '')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dailyC = parseMoney(daily)
  const changedHalf = half.trim() !== '' && dailyC !== null && parseMoney(half) !== Math.round(dailyC / 2)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (changedHalf && farm.pinHash && !(await verifyPin(farm, pin))) throw new WorkerError('PIN da fazenda incorreto (ajuste da meia diária).')
      const input = { name, dailyCents: dailyC ?? 0, halfCents: half.trim() ? parseMoney(half) : null, halfReason, startDate: start, notes }
      const w = current ? await updateWorker(db, current.id, input) : await createWorker(db, farm.id, input, key)
      onDone?.(w)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack" data-testid="worker-form">
      <div className="status-label">{current ? 'Editar diarista' : 'Novo diarista'}</div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="wk-name">
          Nome completo
        </label>
        <input id="wk-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="wk-daily">
            Valor da diária
          </label>
          <input id="wk-daily" className="input" inputMode="decimal" placeholder="R$" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="wk-half">
            Meia diária
          </label>
          <input id="wk-half" className="input" inputMode="decimal" placeholder={dailyC ? `${formatMoney(Math.round(dailyC / 2))} (metade)` : 'metade da diária'} value={half} onChange={(e) => setHalf(e.target.value)} />
        </div>
      </div>
      {changedHalf && (
        <div className="stack" style={{ gap: 8 }}>
          <input className="input" aria-label="Motivo da meia diária diferente" placeholder="Motivo do ajuste da meia diária" maxLength={200} value={halfReason} onChange={(e) => setHalfReason(e.target.value)} />
          {farm.pinHash && <input className="input" type="password" inputMode="numeric" aria-label="PIN" placeholder="PIN da fazenda" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}
        </div>
      )}
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="wk-start">
          Início do trabalho
        </label>
        <input id="wk-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      <textarea className="input" aria-label="Observações" placeholder="Observações" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={!name.trim() || !daily.trim()}>
          <Icon name="check" /> Salvar
        </button>
      </div>
    </form>
  )
}

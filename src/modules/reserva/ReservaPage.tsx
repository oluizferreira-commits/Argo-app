import { useState, type FormEvent } from 'react'
import { newId } from '../../core/ids'
import { formatMoney, parseMoney } from '../../core/money'
import { db } from '../../db/database'
import type { ReserveEntry } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { formatDay, todayLocal } from '../rebanho/herd'
import { formatSaleNumber } from '../vendas/sales'
import { RESERVE_PERCENT, recordReserveEntry, ReserveError, reverseReserveEntry } from './reserve'
import { useReserve } from './useReserve'

type Msg = { kind: 'ok' | 'error'; text: string } | null

export function ReservaPage() {
  const { farm } = useFarm()
  const r = useReserve()
  const [msg, setMsg] = useState<Msg>(null)
  const [form, setForm] = useState<'retirada' | 'deposito' | null>(null)
  if (!r) return null
  const s = r.summary

  async function deposit(amountCents: number, paymentId: string | null, notes: string) {
    setMsg(null)
    try {
      await recordReserveEntry(db, farm.id, { type: 'deposito', date: todayLocal(), amountCents, paymentId, notes })
      setMsg({ kind: 'ok', text: `Transferência de ${formatMoney(amountCents)} para a reserva registrada.` })
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ReserveError ? e.message : (e as Error).message })
    }
  }

  async function reverse(e: ReserveEntry) {
    const reason = window.prompt(`Estornar ${e.type === 'deposito' ? 'o depósito' : 'a retirada'} de ${formatMoney(e.amountCents)}?\n\nInforme o motivo:`)
    if (reason === null) return
    try {
      await reverseReserveEntry(db, e.id, reason)
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message })
    }
  }

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>Saldo da reserva (conta separada)</p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 36 }} data-testid="reserve-balance">
          {formatMoney(s.balanceCents)}
        </div>
        <p>
          {RESERVE_PERCENT}% de cada venda, separado conforme o dinheiro é recebido.
        </p>
      </section>

      {s.pendingCents > 0 ? (
        <div className="notice notice-warn" role="alert">
          <Icon name="alert" />
          <div className="stack" style={{ gap: 10, flex: 1 }}>
            <div>
              <strong>Separe {formatMoney(s.pendingCents)} para a reserva</strong> ({RESERVE_PERCENT}% do que já foi recebido e ainda não foi transferido).
            </div>
            <button
              className="btn btn-gold btn-block"
              data-testid="deposit-all"
              onClick={() => window.confirm(`Confirmar que transferiu ${formatMoney(s.pendingCents)} para a conta da reserva?`) && deposit(s.pendingCents, null, 'Transferência dos 35%')}
            >
              <Icon name="check" /> Já transferi {formatMoney(s.pendingCents)}
            </button>
          </div>
        </div>
      ) : (
        <div className="notice notice-ok" data-testid="reserve-ok">
          <Icon name="check" />
          <div>Reserva em dia: tudo o que precisava ser separado já foi transferido.</div>
        </div>
      )}

      {msg && (
        <div className={`notice notice-${msg.kind}`} role="status">
          <Icon name={msg.kind === 'ok' ? 'check' : 'alert'} />
          <div>{msg.text}</div>
        </div>
      )}

      <div className="card">
        <dl className="kv" data-testid="reserve-kv">
          <dt>Meta ({RESERVE_PERCENT}% das vendas)</dt>
          <dd>{formatMoney(s.targetCents)}</dd>
          <dt>{RESERVE_PERCENT}% do que já foi recebido</dt>
          <dd>{formatMoney(s.dueCents)}</dd>
          <dt>Transferido para a reserva</dt>
          <dd>{formatMoney(s.depositedCents)}</dd>
          <dt>Retirado da reserva</dt>
          <dd>{formatMoney(s.withdrawnCents)}</dd>
          <dt>Falta separar</dt>
          <dd style={{ color: s.pendingCents ? 'var(--warn)' : 'var(--ok)' }}>{formatMoney(s.pendingCents)}</dd>
          {s.surplusCents > 0 && (
            <>
              <dt>Transferido a mais</dt>
              <dd>{formatMoney(s.surplusCents)}</dd>
            </>
          )}
        </dl>
      </div>

      {r.pendingPayments.length > 0 && (
        <>
          <h2 className="section-title">A separar por recebimento</h2>
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {r.pendingPayments.map(({ payment: p, pendingCents }) => {
              const sale = r.sales.get(p.saleId)
              return (
                <div className="task" key={p.id}>
                  <div className="status-body">
                    <div className="status-label">
                      {r.clients.get(p.clientId)?.name ?? '—'} · recebido {formatMoney(p.amountCents)}
                    </div>
                    <div className="status-detail">
                      {formatDay(p.date)}
                      {sale ? ` · venda nº ${formatSaleNumber(sale.number)}` : ''} · separar {formatMoney(pendingCents)}
                    </div>
                  </div>
                  <button className="btn btn-outline" style={{ minHeight: 44, padding: '0 12px' }} onClick={() => deposit(pendingCents, p.id, 'Transferência dos 35%')}>
                    Transferi
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      {form ? (
        <EntryForm type={form} balance={s.balanceCents} onClose={() => setForm(null)} onDone={(t) => setMsg({ kind: 'ok', text: t })} />
      ) : (
        <div className="row">
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setForm('retirada')} disabled={s.balanceCents <= 0}>
            <Icon name="minusCircle" /> Retirada
          </button>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setForm('deposito')}>
            <Icon name="plus" /> Depósito avulso
          </button>
        </div>
      )}

      <h2 className="section-title">Movimentos da reserva</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="reserve-history">
        {r.entries.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0' }}>
            Nenhum movimento ainda.
          </p>
        ) : (
          r.entries.map((e) => (
            <div className={`task${e.status === 'estornado' ? ' reversed' : ''}`} key={e.id}>
              <div className="status-icon">
                <Icon name={e.type === 'deposito' ? 'plus' : 'minusCircle'} />
              </div>
              <div className="status-body">
                <div className="status-label">
                  <span className={e.type === 'deposito' ? 'delta-plus' : 'delta-minus'}>
                    {e.type === 'deposito' ? '+' : '−'}
                    {formatMoney(e.amountCents)}
                  </span>{' '}
                  · {e.type === 'deposito' ? 'Depósito' : 'Retirada'}
                  {e.status === 'estornado' && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Estornado</span>}
                </div>
                <div className="status-detail">
                  {formatDay(e.date)}
                  {e.notes && ` · ${e.notes}`}
                  {e.status === 'estornado' && e.reverseReason && ` · estorno: ${e.reverseReason}`}
                </div>
              </div>
              {e.status === 'ativo' && (
                <button className="btn btn-danger btn-icon" aria-label={`Estornar ${e.type} de ${formatMoney(e.amountCents)}`} onClick={() => reverse(e)}>
                  <Icon name="undo" size={20} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </>
  )
}

function EntryForm({ type, balance, onClose, onDone }: { type: 'retirada' | 'deposito'; balance: number; onClose: () => void; onDone: (text: string) => void }) {
  const { farm } = useFarm()
  const [key] = useState(newId)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayLocal)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const cents = parseMoney(amount)
    if (!cents) return setError('Informe o valor.')
    setSaving(true)
    try {
      await recordReserveEntry(db, farm.id, { type, date, amountCents: cents, notes }, key)
      onDone(`${type === 'retirada' ? 'Retirada' : 'Depósito'} de ${formatMoney(cents)} registrado.`)
      onClose()
    } catch (err) {
      setError(err instanceof ReserveError ? err.message : (err as Error).message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="card stack">
      <div className="status-label">{type === 'retirada' ? 'Retirada da reserva' : 'Depósito avulso na reserva'}</div>
      {type === 'retirada' && <p className="muted">Saldo disponível: {formatMoney(balance)}</p>}
      <div className="field">
        <label className="label" htmlFor="rs-amount">
          Valor
        </label>
        <input id="rs-amount" className="input" inputMode="decimal" placeholder="R$ 0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="rs-date">
          Data
        </label>
        <input id="rs-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="rs-notes">
          {type === 'retirada' ? 'Motivo (obrigatório)' : 'Observação'}
        </label>
        <input
          id="rs-notes"
          className="input"
          maxLength={200}
          placeholder={type === 'retirada' ? 'Ex.: compra de sal mineral' : ''}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
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
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving || !amount.trim() || (type === 'retirada' && !notes.trim())}>
          <Icon name="check" /> Registrar
        </button>
      </div>
    </form>
  )
}

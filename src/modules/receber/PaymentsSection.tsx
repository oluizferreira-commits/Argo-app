import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { newId } from '../../core/ids'
import { formatMoney, parseMoney } from '../../core/money'
import { db } from '../../db/database'
import type { Payment, PaymentMethod, Sale } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { formatDay, todayLocal } from '../rebanho/herd'
import { METHOD_LABELS, PaymentError, recordPayment, reversePayment, saleBalance, STATUS_BADGE, STATUS_LABEL } from './receivables'
import { formatPercent, rateOn, recordReserveEntry, reservePendingByPayment, reserveShare } from '../reserva/reserve'


/** Recebimentos da venda: saldo, parcelas, registrar e estornar. */
export function PaymentsSection({ sale, payments }: { sale: Sale; payments: Payment[] }) {
  const { farm } = useFarm()
  const balance = saleBalance(sale, payments)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(newId)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayLocal)
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [notes, setNotes] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const reserveData = useLiveQuery(async () => {
    const [entries, allPayments] = await Promise.all([
      db.reserveEntries.where('farmId').equals(farm.id).toArray(),
      db.payments.where('farmId').equals(farm.id).toArray(),
    ])
    return reservePendingByPayment(allPayments, entries, farm)
  }, [farm, payments])
  const reserveEntries = reserveData
  const reserveOf = (p: Payment) => reserveData?.get(p.id) ?? 0

  async function separate(p: Payment) {
    const cents = reserveOf(p)
    if (!cents) return
    try {
      await recordReserveEntry(db, farm.id, { type: 'deposito', date: todayLocal(), amountCents: cents, paymentId: p.id, notes: 'Transferência para a reserva' })
      setMsg({ kind: 'ok', text: `Transferência de ${formatMoney(cents)} para a reserva registrada.` })
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message })
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    const cents = parseMoney(amount)
    if (!cents) return setMsg({ kind: 'error', text: 'Informe o valor recebido.' })
    setBusy(true)
    try {
      await recordPayment(db, farm.id, { saleId: sale.id, date, amountCents: cents, method, notes }, key)
      setKey(newId())
      setAmount('')
      setNotes('')
      setOpen(false)
      setMsg({
        kind: 'ok',
        text: `Recebimento de ${formatMoney(cents)} registrado. Separe ${formatMoney(reserveShare(cents, rateOn(farm, date)))} (${formatPercent(rateOn(farm, date))}) para a reserva.`,
      })
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof PaymentError ? err.message : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function reverse(p: Payment) {
    const reason = window.prompt(`Estornar o recebimento de ${formatMoney(p.amountCents)}?\n\nO valor volta a ficar em aberto. Informe o motivo:`)
    if (reason === null) return
    try {
      await reversePayment(db, p.id, reason)
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message })
    }
  }

  const list = [...payments].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

  return (
    <>
      <h2 className="section-title">Recebimento</h2>
      <div className="card stack" data-testid="sale-balance">
        <div className="row" style={{ justifyContent: 'space-around', textAlign: 'center' }}>
          <div>
            <div className="num" style={{ fontSize: 20, color: 'var(--ok)' }}>
              {formatMoney(balance.paidCents)}
            </div>
            <div className="muted">recebido</div>
          </div>
          <div>
            <div className="num" style={{ fontSize: 20, color: balance.openCents ? 'var(--warn)' : 'var(--ok)' }} data-testid="sale-open">
              {formatMoney(balance.openCents)}
            </div>
            <div className="muted">{balance.settled ? 'quitada' : 'em aberto'}</div>
          </div>
        </div>
        <div>
          {balance.installments.map((st) => (
            <div className="cat-line" key={st.index}>
              <span>
                {balance.installments.length > 1 ? `Parcela ${st.index + 1}` : 'Vencimento'} · {formatDay(st.due)}
                {st.status === 'parcial' || (st.status === 'vencida' && st.paidCents > 0) ? (
                  <span className="status-detail" style={{ display: 'block' }}>
                    pago {formatMoney(st.paidCents)} · falta {formatMoney(st.openCents)}
                  </span>
                ) : null}
              </span>
              <span style={{ textAlign: 'right' }}>
                <span className="num">{formatMoney(st.amountCents)}</span>{' '}
                <span className={`badge ${STATUS_BADGE[st.status]}`}>{STATUS_LABEL[st.status]}</span>
              </span>
            </div>
          ))}
        </div>

        {!balance.settled &&
          (open ? (
            <form onSubmit={submit} className="stack">
              <div className="field">
                <label className="label" htmlFor="pg-amount">
                  Valor recebido
                </label>
                <input
                  id="pg-amount"
                  className="input"
                  inputMode="decimal"
                  placeholder={`Saldo: ${formatMoney(balance.openCents)}`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => setAmount((balance.openCents / 100).toFixed(2).replace('.', ','))}>
                  Valor total em aberto ({formatMoney(balance.openCents)})
                </button>
              </div>
              <div className="field">
                <label className="label" htmlFor="pg-method">
                  Forma de pagamento
                </label>
                <select id="pg-method" className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="pg-date">
                  Data do recebimento
                </label>
                <input id="pg-date" type="date" className="input" value={date} min={sale.date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="pg-notes">
                  Observação
                </label>
                <input id="pg-notes" className="input" value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={busy || !amount.trim()}>
                <Icon name="check" /> Registrar recebimento
              </button>
              <button type="button" className="btn btn-outline btn-block" onClick={() => setOpen(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <button className="btn btn-gold btn-block" onClick={() => setOpen(true)}>
              <Icon name="cash" /> Registrar recebimento
            </button>
          ))}

        {msg && (
          <div className={`notice notice-${msg.kind}`} role="status">
            <Icon name={msg.kind === 'ok' ? 'check' : 'alert'} />
            <div>{msg.text}</div>
          </div>
        )}

        {list.length > 0 && (
          <div>
            <div className="group-title">Recebimentos</div>
            {list.map((p) => (
              <div className={`task${p.status === 'estornado' ? ' reversed' : ''}`} key={p.id}>
                <div className="status-icon">
                  <Icon name="cash" />
                </div>
                <div className="status-body">
                  <div className="status-label">
                    {formatMoney(p.amountCents)} · {METHOD_LABELS[p.method]}
                    {p.status === 'estornado' && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Estornado</span>}
                  </div>
                  <div className="status-detail">
                    {formatDay(p.date)}
                    {p.notes && ` · ${p.notes}`}
                    {p.status === 'estornado' && p.reverseReason && ` · estorno: ${p.reverseReason}`}
                  </div>
                  {p.status === 'ativo' && reserveEntries && (
                    reserveOf(p) > 0 ? (
                      <button type="button" className="btn btn-gold" style={{ minHeight: 40, marginTop: 6, fontSize: 14 }} onClick={() => separate(p)} data-testid="separate">
                        Já transferi {formatMoney(reserveOf(p))} para a reserva
                      </button>
                    ) : (
                      <div className="status-detail" style={{ color: 'var(--ok)' }}>
                        ✓ {formatPercent(rateOn(farm, p.date))} separado na reserva
                      </div>
                    )
                  )}
                </div>
                {p.status === 'ativo' && (
                  <button className="btn btn-danger btn-icon" aria-label={`Estornar recebimento de ${formatMoney(p.amountCents)}`} onClick={() => reverse(p)}>
                    <Icon name="undo" size={20} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

import { useState, type FormEvent } from 'react'
import { newId } from '../../core/ids'
import { formatMoney, parseMoney } from '../../core/money'
import { db } from '../../db/database'
import type { ReserveCheck } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { formatDay, todayLocal } from '../rebanho/herd'
import { adjustFromCheck, CHECK_REMINDER_DAYS, daysSinceCheck, DEFAULT_ACCOUNT, recordReserveCheck, ReserveError } from './reserve'

const signed = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatMoney(Math.abs(c))}`

/** Conferência do saldo da reserva com o banco (Mercado Pago). */
export function BalanceCheck({ checks, balanceCents }: { checks: ReserveCheck[]; balanceCents: number }) {
  const { farm } = useFarm()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(newId)
  const [amount, setAmount] = useState('')
  const [account, setAccount] = useState(checks[0]?.account ?? DEFAULT_ACCOUNT)
  const [error, setError] = useState<string | null>(null)
  const last = checks[0] ?? null
  const days = daysSinceCheck(checks)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const cents = parseMoney(amount)
    if (cents === null) return setError('Informe o saldo que aparece no banco.')
    try {
      await recordReserveCheck(db, farm.id, { informedCents: cents, date: todayLocal(), account }, key)
      setKey(newId())
      setAmount('')
      setOpen(false)
    } catch (err) {
      setError(err instanceof ReserveError ? err.message : (err as Error).message)
    }
  }

  return (
    <>
      <h2 className="section-title">Conferência com o {account}</h2>
      <div className="card stack" data-testid="balance-check">
        {last ? <CheckResult check={last} currentBalance={balanceCents} /> : <p className="muted">Você ainda não conferiu o saldo da reserva com o banco.</p>}

        {days !== null && days > CHECK_REMINDER_DAYS && (
          <div className="notice notice-warn">
            <Icon name="clock" />
            <div>Última conferência há {days} dias. Confira o saldo no {account}.</div>
          </div>
        )}

        {open ? (
          <form onSubmit={submit} className="stack">
            <p className="muted">Abra o {account}, veja o saldo da reserva e digite aqui. O ARGO compara com o saldo dele ({formatMoney(balanceCents)}).</p>
            <div className="field">
              <label className="label" htmlFor="bc-amount">
                Saldo no {account}
              </label>
              <input id="bc-amount" className="input" inputMode="decimal" placeholder="R$ 0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="bc-account">
                Conta
              </label>
              <input id="bc-account" className="input" maxLength={40} value={account} onChange={(e) => setAccount(e.target.value)} />
            </div>
            {error && (
              <div className="notice notice-error" role="alert">
                <Icon name="alert" />
                <div>{error}</div>
              </div>
            )}
            <div className="row">
              <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={!amount.trim()}>
                <Icon name="check" /> Conferir
              </button>
            </div>
          </form>
        ) : (
          <button className="btn btn-gold btn-block" onClick={() => setOpen(true)} data-testid="open-check">
            <Icon name="shield" /> Conferir saldo
          </button>
        )}

        {checks.length > 1 && (
          <div>
            <div className="group-title">Conferências anteriores</div>
            {checks.slice(1, 6).map((c) => (
              <div className="cat-line" key={c.id}>
                <span>
                  {formatDay(c.date)} · {c.account}: {formatMoney(c.informedCents)}
                </span>
                <span className={c.differenceCents === 0 ? 'delta-plus' : 'delta-minus'}>{c.differenceCents === 0 ? '✓ conferiu' : signed(c.differenceCents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function CheckResult({ check, currentBalance }: { check: ReserveCheck; currentBalance: number }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // depois de ajustar (ou de novos lançamentos), o saldo do ARGO pode já bater com o informado
  const nowMatches = currentBalance === check.informedCents
  const diff = check.differenceCents

  async function adjust(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await adjustFromCheck(db, check, reason)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" data-testid="check-result">
      <dl className="kv">
        <dt>Conferido em</dt>
        <dd>{formatDay(check.date)}</dd>
        <dt>No {check.account}</dt>
        <dd>{formatMoney(check.informedCents)}</dd>
        <dt>No ARGO (na hora)</dt>
        <dd>{formatMoney(check.systemCents)}</dd>
        <dt>Diferença</dt>
        <dd style={{ color: diff === 0 ? 'var(--ok)' : 'var(--warn)' }}>{diff === 0 ? 'nenhuma' : signed(diff)}</dd>
      </dl>
      {diff === 0 ? (
        <div className="notice notice-ok">
          <Icon name="check" />
          <div>Saldo confere com o {check.account}.</div>
        </div>
      ) : nowMatches ? (
        <div className="notice notice-ok">
          <Icon name="check" />
          <div>Diferença ajustada: o ARGO agora mostra o mesmo saldo do {check.account}.</div>
        </div>
      ) : (
        <form onSubmit={adjust} className="stack">
          <div className="notice notice-warn">
            <Icon name="alert" />
            <div>
              {diff < 0
                ? `No ${check.account} há ${formatMoney(-diff)} a menos que no ARGO. Pode ser uma retirada ou tarifa não registrada.`
                : `No ${check.account} há ${formatMoney(diff)} a mais que no ARGO. Pode ser uma transferência não registrada ou rendimento.`}
            </div>
          </div>
          <input
            className="input"
            aria-label="Motivo do ajuste"
            placeholder={diff < 0 ? 'Motivo (ex.: tarifa do banco)' : 'Motivo (ex.: rendimento, transferência esquecida)'}
            maxLength={120}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && (
            <div className="notice notice-error" role="alert">
              <Icon name="alert" />
              <div>{error}</div>
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !reason.trim()} data-testid="adjust">
            <Icon name="check" /> Ajustar ARGO ({diff < 0 ? 'registrar retirada' : 'registrar depósito'} de {formatMoney(Math.abs(diff))})
          </button>
        </form>
      )}
    </div>
  )
}

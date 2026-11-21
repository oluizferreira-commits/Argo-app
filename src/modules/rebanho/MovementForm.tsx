import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { MovementEntry } from '../../db/types'
import { CATEGORIES, category, laterCategories, nextCategory, NEWBORN_CATEGORIES, type CategoryId } from '../../domain/categories'
import { COUNT_REASONS, MOVEMENT_INFO, type CountReason } from '../../domain/movements'
import { CategoryQuantities } from '../../components/CategoryQuantities'
import { sumQty, toQuantities, type QtyText } from '../../components/quantities'
import { Icon } from '../../components/Icon'
import { Stepper } from '../../components/Stepper'
import {
  balanceOf,
  entriesCategoryChange,
  entriesCount,
  entriesIn,
  entriesOut,
  entriesTransfer,
  HerdError,
  recordMovement,
  todayLocal,
  type CategoryChangeLine,
} from './herd'
import type { FormType } from './MovimentarPage'
import { useBalances, usePastures } from './useHerd'

const NOTES_PLACEHOLDER: Record<FormType, string> = {
  nascimento: 'Opcional',
  compra: 'Ex.: de quem comprou, onde',
  transferencia: 'Opcional',
  'mudanca-categoria': 'Opcional',
  morte: 'Ex.: causa da morte',
  venda: 'Ex.: comprador (detalhes financeiros na etapa de vendas)',
  contagem: 'Opcional',
}

export function MovementForm({ type }: { type: FormType }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const pastures = usePastures()
  const { balances, ready } = useBalances()

  const [formKey] = useState(newId)
  const [date, setDate] = useState(todayLocal)
  const [from, setFrom] = useState(params.get('pasto') ?? '')
  const [to, setTo] = useState('')
  const [qty, setQty] = useState<QtyText>({})
  const [changeDest, setChangeDest] = useState<Partial<Record<CategoryId, CategoryId>>>({})
  const [reasons, setReasons] = useState<Partial<Record<CategoryId, CountReason>>>({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const avail = (c: CategoryId) => (from ? balanceOf(balances, from, c) : 0)
  const needsTo = type === 'transferencia' || type === 'mudanca-categoria'
  const usesAvailable = type === 'morte' || type === 'venda' || type === 'transferencia' || type === 'mudanca-categoria'

  const pastureEmptyHistory = useMemo(
    () => CATEGORIES.every((c) => balanceOf(balances, from, c.id) === 0),
    [balances, from],
  )

  // Linhas de mudança de categoria (origem → destino escolhido).
  const changeLines: CategoryChangeLine[] = CATEGORIES.filter((c) => nextCategory(c.id)).flatMap((c) => {
    const n = Number(qty[c.id] ?? '')
    return n > 0 ? [{ from: c.id, to: changeDest[c.id] ?? nextCategory(c.id)!, quantity: n }] : []
  })

  // Diferenças da contagem.
  const countEntries: MovementEntry[] = type === 'contagem' && from ? entriesCount(from, countedQty(qty), balances, reasons) : []

  function countedQty(v: QtyText) {
    const out: Partial<Record<CategoryId, number>> = {}
    for (const [k, t] of Object.entries(v) as [CategoryId, string][]) if (t !== '') out[k] = Number(t)
    return out
  }

  function buildEntries(): MovementEntry[] {
    const q = toQuantities(qty)
    switch (type) {
      case 'nascimento':
      case 'compra':
        return entriesIn(from, q)
      case 'morte':
      case 'venda':
        return entriesOut(from, q)
      case 'transferencia':
        return entriesTransfer(from, to, q)
      case 'mudanca-categoria':
        return entriesCategoryChange(from, to || from, changeLines)
      case 'contagem':
        return countEntries
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (!from) return setError('Escolha o pasto.')
    if (type === 'transferencia' && (!to || to === from)) return setError('Escolha um pasto de destino diferente.')
    if (type === 'contagem') {
      if (Object.values(qty).every((v) => v === '' || v === undefined)) return setError('Informe a contagem de ao menos uma categoria.')
      if (countEntries.length === 0) return setError('A contagem bate com o saldo: não há diferença a registrar.')
      if (countEntries.some((x) => !reasonOptions(x).includes(reasons[x.category] as CountReason)))
        return setError('Escolha o motivo de cada diferença.')
    }
    setSaving(true)
    try {
      const m = await recordMovement(db, { type, date, entries: buildEntries(), notes }, formKey)
      navigate(`/rebanho/movimentacao/${m.id}`, { replace: true, state: { saved: true } })
    } catch (err) {
      setError(err instanceof HerdError ? err.message : `Não foi possível salvar: ${(err as Error).message}`)
      setSaving(false)
    }
  }

  if (!pastures || !ready) return null

  const total =
    type === 'mudanca-categoria' ? changeLines.reduce((a, l) => a + l.quantity, 0) : type === 'contagem' ? countEntries.length : sumQty(qty)

  return (
    <form onSubmit={submit} className="stack">
      <div className="row" style={{ margin: '0 4px' }}>
        <Icon name={MOVEMENT_INFO[type].icon} />
        <div>
          <div className="status-label">{MOVEMENT_INFO[type].label}</div>
          <div className="status-detail">{MOVEMENT_INFO[type].description}</div>
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label className="label" htmlFor="mv-from">
            {needsTo ? 'Pasto de origem' : 'Pasto'}
          </label>
          <select
            id="mv-from"
            className="input"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setQty({})
              setReasons({})
            }}
          >
            <option value="">Escolha…</option>
            {pastures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {needsTo && (
          <div className="field">
            <label className="label" htmlFor="mv-to">
              Pasto de destino
            </label>
            <select id="mv-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              {type === 'mudanca-categoria' ? <option value="">Mesmo pasto</option> : <option value="">Escolha…</option>}
              {pastures
                .filter((p) => p.id !== from)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="mv-date">
            Data
          </label>
          <input id="mv-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {from && (
        <div className="card">
          {type === 'mudanca-categoria' ? (
            <CategoryChangeFields
              available={avail}
              qty={qty}
              setQty={setQty}
              dest={changeDest}
              setDest={setChangeDest}
            />
          ) : type === 'contagem' ? (
            <CountFields
              expected={avail}
              qty={qty}
              setQty={setQty}
              entries={countEntries}
              reasons={reasons}
              setReasons={setReasons}
              firstCount={pastureEmptyHistory}
            />
          ) : (
            <>
              <div className="label">Quantidades</div>
              <CategoryQuantities
                value={qty}
                onChange={setQty}
                only={type === 'nascimento' ? NEWBORN_CATEGORIES : undefined}
                available={usesAvailable ? avail : undefined}
                hideEmpty={usesAvailable}
              />
            </>
          )}
        </div>
      )}

      <div className="card">
        <label className="label" htmlFor="mv-notes">
          Observação
        </label>
        <textarea
          id="mv-notes"
          className="input"
          value={notes}
          maxLength={500}
          placeholder={NOTES_PLACEHOLDER[type]}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}

      <div className="sticky-actions">
        <button type="submit" className="btn btn-primary btn-block" disabled={saving || !from || total === 0}>
          <Icon name="check" />
          {saving
            ? 'Salvando…'
            : type === 'contagem'
              ? `Registrar contagem${total ? ` (${total} diferença${total > 1 ? 's' : ''})` : ''}`
              : `Registrar${total ? ` ${total} cab.` : ''}`}
        </button>
      </div>
    </form>
  )
}

function CategoryChangeFields(props: {
  available: (c: CategoryId) => number
  qty: QtyText
  setQty: (v: QtyText) => void
  dest: Partial<Record<CategoryId, CategoryId>>
  setDest: (v: Partial<Record<CategoryId, CategoryId>>) => void
}) {
  const sources = CATEGORIES.filter((c) => nextCategory(c.id) && props.available(c.id) > 0)
  if (sources.length === 0) return <p className="muted">Não há animais que possam mudar de categoria neste pasto.</p>
  return (
    <div className="stack">
      <div className="label">Quantos mudaram de categoria?</div>
      {sources.map((c) => (
        <div key={c.id} className="qty-row" style={{ flexWrap: 'wrap' }}>
          <div className="qty-label">
            <div className="status-label">{c.plural}</div>
            <div className="status-detail">Disponível: {props.available(c.id)}</div>
          </div>
          <Stepper
            label={c.plural}
            value={props.qty[c.id] ?? ''}
            max={props.available(c.id)}
            onChange={(v) => props.setQty({ ...props.qty, [c.id]: v })}
          />
          {Number(props.qty[c.id] ?? 0) > 0 && (
            <div style={{ width: '100%' }}>
              <label className="status-detail" htmlFor={`dest-${c.id}`}>
                Passam a ser:
              </label>
              <select
                id={`dest-${c.id}`}
                className="input"
                value={props.dest[c.id] ?? nextCategory(c.id)!}
                onChange={(e) => props.setDest({ ...props.dest, [c.id]: e.target.value as CategoryId })}
              >
                {laterCategories(c.id).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function reasonOptions(e: MovementEntry): CountReason[] {
  if (e.delta > 0) {
    const opts: CountReason[] = ['saldo-inicial']
    if (NEWBORN_CATEGORIES.includes(e.category)) opts.push('nascimento-nao-registrado')
    return [...opts, 'erro-contagem', 'outro']
  }
  return ['morte-nao-registrada', 'erro-contagem', 'outro']
}

function CountFields(props: {
  expected: (c: CategoryId) => number
  qty: QtyText
  setQty: (v: QtyText) => void
  entries: MovementEntry[]
  reasons: Partial<Record<CategoryId, CountReason>>
  setReasons: (v: Partial<Record<CategoryId, CountReason>>) => void
  firstCount: boolean
}) {
  function setCount(v: QtyText) {
    props.setQty(v)
    // Primeira contagem de um pasto vazio: motivo padrão "saldo inicial".
    if (props.firstCount) {
      const r: Partial<Record<CategoryId, CountReason>> = {}
      for (const k of Object.keys(v) as CategoryId[]) r[k] = 'saldo-inicial'
      props.setReasons(r)
    }
  }
  return (
    <div className="stack">
      <div>
        <div className="label">Quantos você contou?</div>
        <p className="muted">Deixe em branco (—) a categoria que não foi contada. Use 0 se contou e não havia nenhum.</p>
      </div>
      {(['M', 'F'] as const).map((sex) => (
        <div key={sex}>
          <div className="group-title">{sex === 'M' ? 'Machos' : 'Fêmeas'}</div>
          {CATEGORIES.filter((c) => c.sex === sex).map((c) => (
            <div className="qty-row" key={c.id}>
              <div className="qty-label">
                <div className="status-label">{c.label}</div>
                <div className="status-detail">No sistema: {props.expected(c.id)}</div>
              </div>
              <Stepper label={c.label} placeholder="—" value={props.qty[c.id] ?? ''} onChange={(v) => setCount({ ...props.qty, [c.id]: v })} />
            </div>
          ))}
        </div>
      ))}
      {props.entries.length > 0 && (
        <div className="stack">
          <div className="group-title">Diferenças encontradas</div>
          {props.entries.map((e) => (
            <div key={e.category}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="status-label">{category(e.category).label}</span>
                <span className={`num ${e.delta > 0 ? 'delta-plus' : 'delta-minus'}`}>
                  {e.delta > 0 ? '+' : '−'}
                  {Math.abs(e.delta)}
                </span>
              </div>
              <select
                className="input"
                aria-label={`Motivo da diferença em ${category(e.category).label}`}
                value={reasonOptions(e).includes(props.reasons[e.category] as CountReason) ? props.reasons[e.category] : ''}
                onChange={(ev) => props.setReasons({ ...props.reasons, [e.category]: ev.target.value as CountReason })}
                style={{ marginTop: 6 }}
              >
                <option value="">Motivo da diferença…</option>
                {reasonOptions(e).map((r) => (
                  <option key={r} value={r}>
                    {COUNT_REASONS[r]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

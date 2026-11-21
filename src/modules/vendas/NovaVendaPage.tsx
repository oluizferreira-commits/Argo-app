import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { newId } from '../../core/ids'
import { formatDecimal, formatMoney, parseDecimal, parseMoney } from '../../core/money'
import { db } from '../../db/database'
import type { PaymentKind, SaleItem, WeighedAnimal } from '../../db/types'
import { category, type CategoryId } from '../../domain/categories'
import { CategoryQuantities } from '../../components/CategoryQuantities'
import { Icon } from '../../components/Icon'
import { toQuantities, type QtyText } from '../../components/quantities'
import { ClientFields } from '../clientes/ClienteForm'
import { useFarm } from '../fazendas/FarmContext'
import { balanceOf, formatDay, todayLocal } from '../rebanho/herd'
import { useBalances, usePastures } from '../rebanho/useHerd'
import { buildInstallments, computeTotals, createClient, createSale, EMPTY_CLIENT, SaleError, type ClientInput } from './sales'
import { useClients } from './useSales'

const NEW_CLIENT = '__novo__'

export function NovaVendaPage() {
  const { modo } = useParams()
  if (modo !== 'arroba' && modo !== 'cabeca') {
    return (
      <>
        <p className="muted" style={{ margin: '0 4px' }}>
          Como será a venda?
        </p>
        <div className="type-grid">
          <Link to="/vendas/nova/arroba" className="type-tile">
            <div className="tile-icon">
              <Icon name="scale" />
            </div>
            <div className="tile-title">Por arroba</div>
            <div className="tile-desc">Peso de cada animal: vivo (kg ÷ 30) ou abate (@)</div>
          </Link>
          <Link to="/vendas/nova/cabeca" className="type-tile">
            <div className="tile-icon">
              <Icon name="tag" />
            </div>
            <div className="tile-title">Por cabeça</div>
            <div className="tile-desc">Lote com preço por cabeça</div>
          </Link>
        </div>
      </>
    )
  }
  return <SaleForm key={modo} mode={modo} />
}

interface Block {
  pastureId: string
  qty: QtyText
}

function SaleForm({ mode }: { mode: 'arroba' | 'cabeca' }) {
  const navigate = useNavigate()
  const { farm } = useFarm()
  const pastures = usePastures()
  const clients = useClients()
  const { balances, ready } = useBalances()

  const [saleKey] = useState(newId)
  const [clientKey] = useState(newId)
  const [clientId, setClientId] = useState('')
  const [newClient, setNewClient] = useState<ClientInput>(EMPTY_CLIENT)
  const [date, setDate] = useState(todayLocal)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [weighing, setWeighing] = useState<'vivo' | 'carcaca'>('vivo')
  const [weights, setWeights] = useState<Record<string, string>>({})
  const [priceArroba, setPriceArroba] = useState('')
  const [priceHead, setPriceHead] = useState<Partial<Record<CategoryId, string>>>({})
  const [paymentKind, setPaymentKind] = useState<PaymentKind>('avista')
  const [days, setDays] = useState('30')
  const [count, setCount] = useState('2')
  const [interval, setIntervalDays] = useState('30')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pastureName = (id: string) => pastures?.find((p) => p.id === id)?.name ?? ''

  const items: SaleItem[] = useMemo(
    () =>
      blocks.flatMap((b) =>
        (Object.entries(toQuantities(b.qty)) as [CategoryId, number][]).map(([cat, n]) => ({ pastureId: b.pastureId, category: cat, quantity: n })),
      ),
    [blocks],
  )
  const heads = items.reduce((a, i) => a + i.quantity, 0)

  // Animais pesados (venda por arroba): um campo por animal.
  const weightRows = items.flatMap((it) => Array.from({ length: it.quantity }, (_, i) => ({ ...it, index: i, key: `${it.pastureId}|${it.category}|${i}` })))
  const places = weighing === 'vivo' ? 1 : 2
  const animals: (WeighedAnimal | null)[] = weightRows.map((r) => {
    const v = parseDecimal(weights[r.key] ?? '', places)
    return v && v > 0 ? { pastureId: r.pastureId, category: r.category, amount: v } : null
  })
  const filled = animals.filter((a): a is WeighedAnimal => a !== null)
  const allWeighed = weightRows.length > 0 && filled.length === weightRows.length

  const priceArrobaCents = parseMoney(priceArroba)
  const priceHeadCents: Partial<Record<CategoryId, number>> = {}
  for (const [c, t] of Object.entries(priceHead) as [CategoryId, string][]) {
    const v = parseMoney(t)
    if (v) priceHeadCents[c] = v
  }
  const soldCategories = [...new Set(items.map((i) => i.category))]

  const totals = computeTotals({
    mode,
    weighing,
    animals: filled,
    pricePerArrobaCents: priceArrobaCents,
    pricePerHeadCents: priceHeadCents,
    items,
  })
  const installments =
    totals.totalCents > 0
      ? buildInstallments(paymentKind, date, totals.totalCents, {
          days: Number(days) || 0,
          count: Math.min(36, Math.max(2, Number(count) || 2)),
          intervalDays: Math.max(1, Number(interval) || 30),
        })
      : []

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (!clientId) return setError('Escolha o cliente.')
    if (heads === 0) return setError('Escolha os animais vendidos.')
    if (mode === 'arroba' && !allWeighed) return setError(`Informe o peso de todos os animais (${filled.length} de ${weightRows.length}).`)
    if (paymentKind === 'prazo' && !(Number(days) >= 1)) return setError('Informe em quantos dias vence.')
    setSaving(true)
    try {
      const cid = clientId === NEW_CLIENT ? (await createClient(db, farm.id, newClient, clientKey)).id : clientId
      const sale = await createSale(
        db,
        farm.id,
        {
          date,
          clientId: cid,
          mode,
          items,
          weighing: mode === 'arroba' ? weighing : null,
          animals: filled,
          pricePerArrobaCents: mode === 'arroba' ? priceArrobaCents : null,
          pricePerHeadCents: mode === 'cabeca' ? priceHeadCents : {},
          paymentKind,
          installments,
          notes,
        },
        saleKey,
      )
      navigate(`/vendas/${sale.id}`, { replace: true, state: { saved: true } })
    } catch (err) {
      setError(err instanceof SaleError ? err.message : `Não foi possível salvar: ${(err as Error).message}`)
      setSaving(false)
    }
  }

  if (!pastures || !clients || !ready) return null
  const unusedPastures = pastures.filter((p) => !blocks.some((b) => b.pastureId === p.id))

  return (
    <form onSubmit={submit} className="stack">
      <div className="row" style={{ margin: '0 4px' }}>
        <Icon name={mode === 'arroba' ? 'scale' : 'tag'} />
        <div className="status-label">{mode === 'arroba' ? 'Venda por arroba' : 'Venda por cabeça'}</div>
      </div>

      {/* Cliente e data */}
      <div className="card">
        <div className="field">
          <label className="label" htmlFor="v-client">
            Cliente (comprador)
          </label>
          <select id="v-client" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Escolha…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_CLIENT}>+ Cadastrar novo cliente</option>
          </select>
        </div>
        {clientId === NEW_CLIENT && <ClientFields value={newClient} onChange={setNewClient} idPrefix="v-cl" />}
        <div className="field">
          <label className="label" htmlFor="v-date">
            Data da venda
          </label>
          <input id="v-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {/* Animais */}
      <h2 className="section-title">Animais vendidos</h2>
      {blocks.map((b, bi) => (
        <div className="card stack" key={b.pastureId}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="status-label">{pastureName(b.pastureId)}</div>
            <button
              type="button"
              className="btn btn-danger btn-icon"
              aria-label={`Remover ${pastureName(b.pastureId)}`}
              onClick={() => setBlocks(blocks.filter((_, i) => i !== bi))}
            >
              <Icon name="trash" size={20} />
            </button>
          </div>
          <CategoryQuantities
            value={b.qty}
            onChange={(qty) => setBlocks(blocks.map((x, i) => (i === bi ? { ...x, qty } : x)))}
            available={(c) => balanceOf(balances, b.pastureId, c)}
            hideEmpty
          />
        </div>
      ))}
      {unusedPastures.length > 0 && (
        <select
          className="input"
          value=""
          aria-label="Adicionar pasto"
          onChange={(e) => e.target.value && setBlocks([...blocks, { pastureId: e.target.value, qty: {} }])}
        >
          <option value="">{blocks.length ? '+ Adicionar outro pasto' : 'Escolha o pasto de onde saem os animais…'}</option>
          {unusedPastures.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {/* Preço e pesos */}
      {heads > 0 && mode === 'cabeca' && (
        <div className="card">
          <div className="label">Preço por cabeça</div>
          {soldCategories.map((c) => (
            <div className="qty-row" key={c}>
              <div className="qty-label">
                <div className="status-label">{category(c).label}</div>
                <div className="status-detail">{items.filter((i) => i.category === c).reduce((a, i) => a + i.quantity, 0)} cab.</div>
              </div>
              <input
                className="input"
                style={{ width: 160, textAlign: 'right' }}
                inputMode="decimal"
                placeholder="R$ 0,00"
                aria-label={`Preço por cabeça de ${category(c).label}`}
                value={priceHead[c] ?? ''}
                onChange={(e) => setPriceHead({ ...priceHead, [c]: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      {heads > 0 && mode === 'arroba' && (
        <>
          <div className="card stack">
            <div className="label">Pesagem</div>
            <div className="chips">
              <button type="button" className={`chip${weighing === 'vivo' ? ' active' : ''}`} onClick={() => setWeighing('vivo')}>
                Peso vivo (kg)
              </button>
              <button type="button" className={`chip${weighing === 'carcaca' ? ' active' : ''}`} onClick={() => setWeighing('carcaca')}>
                Abate (arrobas)
              </button>
            </div>
            <p className="muted">
              {weighing === 'vivo' ? 'Digite o peso vivo de cada animal em kg. O ARGO divide por 30 para dar as arrobas.' : 'Digite as arrobas de cada animal abatido.'}
            </p>
            {items.map((it) => (
              <div key={`${it.pastureId}|${it.category}`}>
                <div className="group-title">
                  {category(it.category).plural} · {pastureName(it.pastureId)}
                </div>
                {weightRows
                  .filter((r) => r.pastureId === it.pastureId && r.category === it.category)
                  .map((r) => (
                    <div className="qty-row" key={r.key}>
                      <div className="qty-label">
                        {category(r.category).label} {r.index + 1}
                      </div>
                      <input
                        className="input"
                        style={{ width: 150, textAlign: 'right' }}
                        inputMode="decimal"
                        placeholder={weighing === 'vivo' ? 'kg' : '@'}
                        aria-label={`Peso de ${category(r.category).label} ${r.index + 1}`}
                        value={weights[r.key] ?? ''}
                        onChange={(e) => setWeights({ ...weights, [r.key]: e.target.value.replace(/[^\d.,]/g, '') })}
                      />
                    </div>
                  ))}
              </div>
            ))}
          </div>
          <div className="card">
            <label className="label" htmlFor="v-price-arroba">
              Preço da arroba
            </label>
            <input
              id="v-price-arroba"
              className="input"
              inputMode="decimal"
              placeholder="R$ 0,00"
              value={priceArroba}
              onChange={(e) => setPriceArroba(e.target.value)}
            />
          </div>
        </>
      )}

      {/* Pagamento */}
      {heads > 0 && (
        <div className="card stack">
          <div className="label">Pagamento</div>
          <div className="chips">
            {(['avista', 'prazo', 'parcelado'] as const).map((k) => (
              <button type="button" key={k} className={`chip${paymentKind === k ? ' active' : ''}`} onClick={() => setPaymentKind(k)}>
                {k === 'avista' ? 'À vista' : k === 'prazo' ? 'A prazo' : 'Parcelado'}
              </button>
            ))}
          </div>
          {paymentKind === 'prazo' && (
            <div className="row">
              <label className="label" htmlFor="v-days" style={{ margin: 0, flex: 1 }}>
                Vence em quantos dias?
              </label>
              <input id="v-days" className="input" style={{ width: 110, textAlign: 'right' }} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))} />
            </div>
          )}
          {paymentKind === 'parcelado' && (
            <>
              <div className="row">
                <label className="label" htmlFor="v-count" style={{ margin: 0, flex: 1 }}>
                  Número de parcelas
                </label>
                <input id="v-count" className="input" style={{ width: 110, textAlign: 'right' }} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))} />
              </div>
              <div className="row">
                <label className="label" htmlFor="v-interval" style={{ margin: 0, flex: 1 }}>
                  A cada quantos dias
                </label>
                <input id="v-interval" className="input" style={{ width: 110, textAlign: 'right' }} inputMode="numeric" value={interval} onChange={(e) => setIntervalDays(e.target.value.replace(/\D/g, '').slice(0, 3))} />
              </div>
            </>
          )}
          {installments.length > 0 && paymentKind !== 'avista' && (
            <div>
              {installments.map((p, i) => (
                <div className="cat-line" key={i}>
                  <span>
                    {installments.length > 1 ? `Parcela ${i + 1}` : 'Vencimento'} · {formatDay(p.due)}
                  </span>
                  <span className="num">{formatMoney(p.amountCents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {heads > 0 && (
        <div className="card">
          <label className="label" htmlFor="v-notes">
            Observação
          </label>
          <textarea id="v-notes" className="input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
        </div>
      )}

      {/* Resumo */}
      {heads > 0 && (
        <section className="hero" data-testid="sale-summary">
          <p style={{ marginTop: 0 }}>
            {heads} cabeça(s)
            {mode === 'arroba' && weighing === 'vivo' && filled.length > 0 && ` · ${formatDecimal(filled.reduce((a, x) => a + x.amount, 0), 1)} kg`}
            {mode === 'arroba' && filled.length > 0 && ` · ${formatDecimal(totals.arrobasHundredths, 2, 2)} @`}
          </p>
          <div className="big-number" style={{ marginTop: 8, fontSize: 38 }} data-testid="sale-total">
            {formatMoney(totals.totalCents)}
          </div>
          {mode === 'arroba' && !allWeighed && <p>Faltam pesos: {weightRows.length - filled.length}</p>}
        </section>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}

      <div className="sticky-actions">
        <button type="submit" className="btn btn-primary btn-block" disabled={saving || heads === 0 || totals.totalCents <= 0}>
          <Icon name="check" />
          {saving ? 'Salvando…' : `Registrar venda${totals.totalCents > 0 ? ` · ${formatMoney(totals.totalCents)}` : ''}`}
        </button>
      </div>
    </form>
  )
}


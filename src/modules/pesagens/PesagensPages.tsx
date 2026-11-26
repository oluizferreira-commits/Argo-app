import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { newId } from '../../core/ids'
import { formatDecimal, parseDecimal } from '../../core/money'
import { db } from '../../db/database'
import type { WeighingLot } from '../../db/types'
import { category, type CategoryId } from '../../domain/categories'
import { CategoryQuantities } from '../../components/CategoryQuantities'
import { toQuantities, type QtyText } from '../../components/quantities'
import type { SaleItem } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { balanceOf, formatDay } from '../rebanho/herd'
import { useBalances, usePastures } from '../rebanho/useHerd'
import { addWeighing, MAX_HEADS_PER_WEIGHING, cancelLot, compositionHeads, createLot, LotError, lotSummary, removeWeighing, renameLot, setComposition } from './lots'

const kg = (tenths: number) => `${formatDecimal(tenths, 1)} kg`

function useLots() {
  const { farm } = useFarm()
  return useLiveQuery(async () => (await db.weighingLots.where('farmId').equals(farm.id).toArray()).filter((l) => l.deletedAt === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [farm.id])
}

/** Lista de pesagens de lote: abertas (para vender) e já vendidas. */
export function PesagensPage() {
  const { farm } = useFarm()
  const lots = useLots()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  if (!lots) return null
  const open = lots.filter((l) => l.status === 'aberta')
  const sold = lots.filter((l) => l.status === 'vendida')

  async function start() {
    setBusy(true)
    const lot = await createLot(db, farm.id, '', newId())
    navigate(`/pesagens/${lot.id}`)
  }

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <h2 className="font-display" style={{ fontSize: 24, color: 'var(--cream)' }}>
          Pesar primeiro, vender depois
        </h2>
        <p>Pese o lote no curral sem comprador nem preço. Quando fechar o negócio, toque em “Vender este lote”. Os animais só saem do rebanho na venda.</p>
      </section>
      <button type="button" className="btn btn-gold btn-block" onClick={() => void start()} disabled={busy} data-testid="new-lot">
        <Icon name="scale" /> Nova pesagem
      </button>
      {open.length > 0 && (
        <>
          <h2 className="section-title">Lotes pesados (a vender)</h2>
          <div className="card shape-list" data-testid="open-lots">
            {open.map((l) => (
              <LotRow key={l.id} lot={l} />
            ))}
          </div>
        </>
      )}
      {sold.length > 0 && (
        <>
          <h2 className="section-title">Vendidos</h2>
          <div className="card shape-list">
            {sold.slice(0, 20).map((l) => (
              <LotRow key={l.id} lot={l} />
            ))}
          </div>
        </>
      )}
      {lots.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>Nenhuma pesagem ainda.</p>}
    </>
  )
}

function LotRow({ lot }: { lot: WeighingLot }) {
  const s = lotSummary(lot)
  return (
    <Link to={lot.status === 'vendida' && lot.saleId ? `/vendas/${lot.saleId}` : `/pesagens/${lot.id}`} className="shape-row" style={{ textDecoration: 'none' }} data-testid="lot-row">
      <span className="status-body">
        <span className="status-label">{lot.name || `Pesagem de ${formatDay(lot.date)}`}</span>
        <span className="status-detail">
          {s.heads} cab. · {kg(s.kgTenths)} · média {kg(s.avgTenths)}/cab.
        </span>
      </span>
      {lot.status === 'vendida' ? <span className="badge badge-ok">Vendido</span> : <Icon name="chevronRight" size={20} className="muted" />}
    </Link>
  )
}

/**
 * Tela de pesar: em cada pesagem só quantas cabeças subiram (1 a 4, podem ser misturadas) e o peso.
 * O que tem no lote (quantos de cada categoria e de qual pasto) é informado uma vez, quando quiser.
 */
export function PesagemPage() {
  const { id = '' } = useParams()
  const lot = useLiveQuery(() => db.weighingLots.get(id), [id])
  const pastures = usePastures()
  const { balances, ready } = useBalances()
  const navigate = useNavigate()
  const [heads, setHeads] = useState(3)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [editName, setEditName] = useState(false)

  if (lot === undefined || !pastures || !ready) return null
  if (!lot || lot.deletedAt !== null) return <p className="muted">Pesagem não encontrada.</p>
  const s = lotSummary(lot)
  const isOpen = lot.status === 'aberta'
  const pName = (pid: string) => pastures.find((p) => p.id === pid)?.name ?? ''
  const t = parseDecimal(text, 1)
  const preview = t && t > 0 ? Math.round(t / heads) : null
  const compHeads = compositionHeads(s.items)
  const canSell = s.heads > 0 && compHeads === s.heads

  async function add() {
    setErr(null)
    try {
      await addWeighing(db, lot!.id, { heads, kgTenths: t ?? 0 })
      setText('')
    } catch (e) {
      setErr(e instanceof LotError ? e.message : (e as Error).message)
    }
  }

  return (
    <>
      <section className="hero" data-testid="lot-summary">
        <div className="gold-rule" />
        {editName && isOpen ? (
          <input className="input" aria-label="Nome do lote" placeholder="Ex.: Garrotes e novilhas" defaultValue={lot.name} autoFocus onBlur={(e) => (void renameLot(db, lot.id, e.target.value, lot.notes), setEditName(false))} />
        ) : (
          <button type="button" className="status-link" onClick={() => setEditName(true)} style={{ color: 'var(--cream)' }}>
            <span className="font-display" style={{ fontSize: 22 }}>
              {lot.name || `Pesagem de ${formatDay(lot.date)}`}
            </span>{' '}
            {isOpen && <Icon name="edit" size={16} />}
          </button>
        )}
        <div className="kg-total" style={{ marginTop: 10 }}>
          <span>
            <b data-testid="lot-heads">{s.heads} cab.</b> pesadas
          </span>
          <span>
            <b data-testid="lot-kg">{kg(s.kgTenths)}</b> total
          </span>
          <span>
            <b data-testid="lot-avg">{s.heads ? kg(s.avgTenths) : '—'}</b> média por cabeça
          </span>
          <span>
            <b>{lot.weighings.length}</b> pesagens
          </span>
        </div>
      </section>

      {lot.status === 'vendida' && lot.saleId && (
        <Link to={`/vendas/${lot.saleId}`} className="notice notice-ok" style={{ textDecoration: 'none' }}>
          <Icon name="check" />
          <div>Lote vendido. Toque para ver a venda.</div>
        </Link>
      )}

      {isOpen && (
        <div className="card stack kg-entry" data-testid="lot-entry">
          <div className="label" style={{ margin: 0 }}>
            Cabeças na balança (podem estar misturadas)
          </div>
          <div className="chips" role="radiogroup" aria-label="Cabeças nesta pesagem">
            {Array.from({ length: MAX_HEADS_PER_WEIGHING }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={heads === n} className={`chip kg-heads${heads === n ? ' active' : ''}`} onClick={() => setHeads(n)} data-testid={`lot-heads-${n}`}>
                {n}
              </button>
            ))}
          </div>
          <div className="row">
            <input
              className="input"
              inputMode="decimal"
              enterKeyHint="next"
              placeholder="Peso da balança (kg)"
              aria-label="Peso da balança em kg"
              value={text}
              onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void add()
                }
              }}
              data-testid="lot-kg-input"
            />
            <button type="button" className="btn btn-gold" style={{ flex: 'none' }} onClick={() => void add()} data-testid="lot-add">
              Lançar
            </button>
          </div>
          <div className="kg-preview" data-testid="lot-preview" aria-live="polite">
            {preview ? (
              <>
                {heads} cab. · {kg(t!)} → <b>{kg(preview)} por cabeça</b>
              </>
            ) : (
              'Digite o peso: o ARGO mostra o peso por cabeça antes de lançar.'
            )}
          </div>
          {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
        </div>
      )}

      {lot.weighings.length > 0 && (
        <div className="card">
          <ol className="kg-list" data-testid="lot-list">
            {[...lot.weighings].reverse().map((w, ri) => {
              const n = lot.weighings.length - ri
              return (
                <li key={w.id} style={isOpen ? undefined : { gridTemplateColumns: '34px minmax(0, 1fr) auto' }}>
                  <span className="kg-n">{n}</span>
                  <span className="kg-desc">
                    {w.heads} {w.heads === 1 ? 'cabeça' : 'cabeças'}
                  </span>
                  <span className="kg-w">
                    <b>{kg(w.kgTenths)}</b>
                    <small>{kg(Math.round(w.kgTenths / w.heads))}/cab.</small>
                  </span>
                  {isOpen && (
                    <button type="button" className="btn btn-outline btn-icon" aria-label={`Apagar pesagem ${n}`} onClick={() => void removeWeighing(db, lot.id, w.id)}>
                      <Icon name="trash" size={18} />
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}

      <Composition lotId={lot.id} items={s.items} editable={isOpen} weighed={s.heads} pName={pName} pastures={pastures} available={(p, c) => balanceOf(balances, p, c)} />

      {isOpen && s.heads > 0 && (
        <>
          {!canSell && (
            <div className="notice notice-warn" data-testid="lot-mismatch">
              <Icon name="alert" />
              <div>
                {compHeads === 0
                  ? 'Para vender, diga acima o que tem no lote (quantos de cada categoria e de qual pasto).'
                  : `Pesadas ${s.heads} cabeças, mas o lote tem ${compHeads}. Acerte as quantidades ou as pesagens.`}
              </div>
            </div>
          )}
          {canSell ? (
            <Link to={`/vendas/nova/kg?pesagem=${lot.id}`} className="btn btn-gold btn-block" data-testid="sell-lot">
              <Icon name="cash" /> Vender este lote · {s.heads} cab.
            </Link>
          ) : (
            <button type="button" className="btn btn-gold btn-block" disabled data-testid="sell-lot">
              <Icon name="cash" /> Vender este lote
            </button>
          )}
        </>
      )}
      {isOpen && (
        <button
          type="button"
          className="btn btn-danger btn-block"
          onClick={() => {
            if (window.confirm('Cancelar esta pesagem? Nenhum animal sai do rebanho.')) void cancelLot(db, lot.id).then(() => navigate('/pesagens', { replace: true }))
          }}
        >
          Cancelar pesagem
        </button>
      )}
      <p className="muted" style={{ fontSize: 13 }}>
        Cada pesagem fica salva na hora, mesmo sem internet. Os animais só saem do rebanho na venda.
      </p>
    </>
  )
}

/** "O que tem neste lote": cabeças por pasto e categoria (uma vez só, não por pesagem). Salva a cada mudança. */
function Composition({
  lotId,
  items,
  editable,
  weighed,
  pName,
  pastures,
  available,
}: {
  lotId: string
  items: SaleItem[]
  editable: boolean
  weighed: number
  pName: (id: string) => string
  pastures: { id: string; name: string }[]
  available: (p: string, c: CategoryId) => number
}) {
  const [err, setErr] = useState<string | null>(null)
  const byPasture = new Map<string, QtyText>()
  for (const it of items) byPasture.set(it.pastureId, { ...(byPasture.get(it.pastureId) ?? {}), [it.category]: String(it.quantity) })
  const blocks = [...byPasture.entries()].map(([pastureId, qty]) => ({ pastureId, qty }))
  const total = compositionHeads(items)
  const save = (next: { pastureId: string; qty: QtyText }[]) => {
    setErr(null)
    const list = next.flatMap((b) => (Object.entries(toQuantities(b.qty)) as [CategoryId, number][]).map(([category, quantity]) => ({ pastureId: b.pastureId, category, quantity })))
    void setComposition(db, lotId, list).catch((e: Error) => setErr(e.message))
  }
  const unused = pastures.filter((p) => !byPasture.has(p.id))
  const [added, setAdded] = useState<string[]>([])
  const shownBlocks = [...blocks, ...added.filter((p) => !byPasture.has(p)).map((pastureId) => ({ pastureId, qty: {} as QtyText }))]

  return (
    <div className="card stack" data-testid="lot-composition">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="label" style={{ margin: 0 }}>
          O que tem neste lote
        </div>
        <span className={`badge ${total > 0 && total === weighed ? 'badge-ok' : 'badge-gold'}`} data-testid="lot-comp-count">
          {total} cab. informadas · {weighed} pesadas
        </span>
      </div>
      {editable && <p className="muted" style={{ fontSize: 14 }}>Na balança os animais sobem misturados. Aqui você diz só o total de cada categoria e de qual pasto saem — pode ser antes, durante ou depois de pesar.</p>}
      {!editable &&
        items.map((it) => (
          <div key={`${it.pastureId}|${it.category}`} className="status-detail">
            {it.quantity} {category(it.category).plural.toLowerCase()} · {pName(it.pastureId)}
          </div>
        ))}
      {editable &&
        shownBlocks.map((b) => (
          <div key={b.pastureId} className="stack" style={{ gap: 6 }}>
            <div className="status-label">{pName(b.pastureId)}</div>
            <CategoryQuantities
              value={b.qty}
              onChange={(qty) => save(shownBlocks.map((x) => (x.pastureId === b.pastureId ? { ...x, qty } : x)))}
              available={(c) => available(b.pastureId, c)}
              hideEmpty
            />
          </div>
        ))}
      {editable && unused.filter((p) => !added.includes(p.id)).length > 0 && (
        <select
          className="input"
          value=""
          aria-label="Adicionar pasto ao lote"
          onChange={(e) => e.target.value && setAdded([...added, e.target.value])}
        >
          <option value="">{shownBlocks.length ? '+ Animais de outro pasto' : 'Escolha o pasto de onde saem os animais…'}</option>
          {unused
            .filter((p) => !added.includes(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      )}
      {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
    </div>
  )
}

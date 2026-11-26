import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { newId } from '../../core/ids'
import { formatDecimal, parseDecimal } from '../../core/money'
import { db } from '../../db/database'
import type { WeighingLot } from '../../db/types'
import { CATEGORIES, category, type CategoryId } from '../../domain/categories'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { balanceOf, formatDay } from '../rebanho/herd'
import { useBalances, usePastures } from '../rebanho/useHerd'
import { addWeighing, cancelLot, createLot, LotError, lotSummary, removeWeighing, renameLot } from './lots'

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

/** Tela de pesar: escolhe pasto e categoria, quantas cabeças subiram (1 a 3) e o peso. Cada lançamento já fica salvo. */
export function PesagemPage() {
  const { id = '' } = useParams()
  const lot = useLiveQuery(() => db.weighingLots.get(id), [id])
  const pastures = usePastures()
  const { balances, ready } = useBalances()
  const navigate = useNavigate()
  const [pastureId, setPastureId] = useState('')
  const [cat, setCat] = useState<CategoryId | ''>('')
  const [heads, setHeads] = useState(3)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [editName, setEditName] = useState(false)

  if (lot === undefined || !pastures || !ready) return null
  if (!lot || lot.deletedAt !== null) return <p className="muted">Pesagem não encontrada.</p>
  const s = lotSummary(lot)
  const isOpen = lot.status === 'aberta'
  const pName = (pid: string) => pastures.find((p) => p.id === pid)?.name ?? ''

  // padrão: o último pasto/categoria lançados
  const last = lot.weighings.at(-1)
  const pid = pastureId || last?.pastureId || ''
  const usedHere = (p: string, c: CategoryId) => lot.weighings.filter((w) => w.pastureId === p && w.category === c).reduce((a, w) => a + w.heads, 0)
  const cats = pid ? CATEGORIES.filter((c) => balanceOf(balances, pid, c.id) > 0) : []
  const c = (cat && cats.some((x) => x.id === cat) ? cat : last && last.pastureId === pid ? last.category : cats[0]?.id) as CategoryId | undefined
  const left = pid && c ? balanceOf(balances, pid, c) - usedHere(pid, c) : 0
  const h = Math.max(1, Math.min(heads, 3, left || 3))
  const t = parseDecimal(text, 1)
  const preview = t && t > 0 ? Math.round(t / h) : null

  async function add() {
    setErr(null)
    if (!pid || !c) return setErr('Escolha o pasto e a categoria.')
    if (left < h) return setErr(`Só ${left} ${category(c).plural.toLowerCase()} no ${pName(pid)} (pelo Rebanho).`)
    try {
      await addWeighing(db, lot!.id, { pastureId: pid, category: c, heads: h, kgTenths: t ?? 0 })
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
          <input className="input" aria-label="Nome do lote" placeholder="Ex.: Garrotes do Pasto Novo" defaultValue={lot.name} autoFocus onBlur={(e) => (void renameLot(db, lot.id, e.target.value, lot.notes), setEditName(false))} />
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
          <div className="row" style={{ gap: 8 }}>
            <select className="input" aria-label="Pasto" value={pid} onChange={(e) => (setPastureId(e.target.value), setCat(''))}>
              <option value="">Pasto…</option>
              {pastures.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select className="input" aria-label="Categoria" value={c ?? ''} onChange={(e) => setCat(e.target.value as CategoryId)} disabled={!pid}>
              {cats.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.plural} ({balanceOf(balances, pid, x.id) - usedHere(pid, x.id)})
                </option>
              ))}
            </select>
          </div>
          <div className="label" style={{ margin: 0 }}>
            Cabeças na balança
          </div>
          <div className="chips" role="radiogroup" aria-label="Cabeças nesta pesagem">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={h === n} disabled={left > 0 && n > left} className={`chip kg-heads${h === n ? ' active' : ''}`} onClick={() => setHeads(n)} data-testid={`lot-heads-${n}`}>
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
                {h} cab. · {kg(t!)} → <b>{kg(preview)} por cabeça</b>
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
                    {w.heads} {w.heads === 1 ? category(w.category).label.toLowerCase() : category(w.category).plural.toLowerCase()} · {pName(w.pastureId)}
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

      {isOpen && s.heads > 0 && (
        <Link to={`/vendas/nova/kg?pesagem=${lot.id}`} className="btn btn-gold btn-block" data-testid="sell-lot">
          <Icon name="cash" /> Vender este lote · {s.heads} cab.
        </Link>
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
        Cada pesagem fica salva na hora, mesmo sem internet.
      </p>
    </>
  )
}

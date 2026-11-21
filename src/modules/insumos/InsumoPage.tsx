import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { newId } from '../../core/ids'
import { formatMoney, parseMoney } from '../../core/money'
import { db } from '../../db/database'
import type { Supply, SupplyMovement } from '../../db/types'
import { Icon } from '../../components/Icon'
import { NegativeAuthorization } from '../../components/NegativeAuthorization'
import { useFarm } from '../fazendas/FarmContext'
import { formatDay, todayLocal } from '../rebanho/herd'
import { usePastures } from '../rebanho/useHerd'
import {
  formatKg,
  formatSacks,
  isMixture,
  mixtureUsing,
  recordMixture,
  recipeText,
  setRecipe,
  NegativeStockError,
  parseKgPerSack,
  parseSacks,
  recordSupplyMovement,
  reverseSupplyMovement,
  sacksToKg,
  setSupplyActive,
  SupplyError,
  updateSupply,
  type SupplyMovementInput,
} from './supplies'
import { useSupplies, type SupplyRow } from './useSupplies'

type FormType = SupplyMovementInput['type'] | 'mistura'
const TYPE_LABEL: Record<SupplyMovement['type'], string> = { compra: 'Compra', consumo: 'Consumo no cocho', ajuste: 'Ajuste', mistura: 'Mistura feita' }
const movLabel = (m: SupplyMovement) => (m.type === 'mistura' && m.halfSacks < 0 ? 'Usado na mistura' : TYPE_LABEL[m.type])

export function InsumoPage() {
  const { id } = useParams()
  const data = useSupplies()
  const pastures = usePastures()
  const [form, setForm] = useState<FormType | null>(null)
  const [editing, setEditing] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  if (!data || !pastures) return null
  const row = data.rows.find((r) => r.supply.id === id)
  if (!row) return <p className="muted">Produto não encontrado.</p>
  const { supply: s, halves } = row
  const supplies = data.rows.map((r) => r.supply)
  const names = new Map(supplies.map((x) => [x.id, x.name]))
  const mixture = isMixture(s)
  const usedBy = mixture ? undefined : mixtureUsing(supplies, s.id)
  const pastureName = new Map(pastures.map((p) => [p.id, p.name]))
  const history = data.movements
    .filter((m) => m.supplyId === s.id && m.deletedAt === null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

  async function reverse(m: SupplyMovement) {
    const together = m.batchId ? '\n\nOs ingredientes e a mistura desse lançamento serão estornados juntos.' : ''
    const reason = window.prompt(`Estornar ${movLabel(m).toLowerCase()} (${formatSacks(Math.abs(m.halfSacks))})?${together}\n\nInforme o motivo:`)
    if (reason === null) return
    try {
      await reverseSupplyMovement(db, m.id, reason)
      setMsg(null)
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>{s.name} · estoque</p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 36 }} data-testid="supply-stock">
          {formatSacks(halves)}
        </div>
        <p data-testid="supply-kg">{s.gramsPerSack ? `${formatKg(sacksToKg(halves, s.gramsPerSack))} · saco de ${formatKg(s.gramsPerSack / 1000)}` : 'Informe o peso do saco para ver em kg.'}</p>
      </section>

      {halves < 0 && (
        <div className="notice notice-warn">
          <Icon name="alert" />
          <div>Estoque negativo (saída lançada com autorização). Lance a {mixture ? 'mistura' : 'compra'} que falta para acertar.</div>
        </div>
      )}
      {usedBy && (
        <Link to={`/insumos/${usedBy.id}`} className="notice notice-ok" style={{ textDecoration: 'none' }} data-testid="used-in-mixture">
          <Icon name="sack" />
          <div>
            Vai para o cocho misturado. A saída deste produto é lançada em <strong>{usedBy.name} → Mistura feita</strong>.
          </div>
        </Link>
      )}
      {msg && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{msg}</div>
        </div>
      )}

      {mixture &&
        (editingRecipe ? (
          <RecipeEdit mixture={s} supplies={supplies} onClose={() => setEditingRecipe(false)} />
        ) : (
          <div className="card row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="status-label">Receita de uma mistura</div>
              <div className="status-detail" data-testid="recipe">
                {recipeText(s, names)}
              </div>
            </div>
            <button className="btn btn-outline btn-icon" aria-label="Alterar receita da mistura" onClick={() => setEditingRecipe(true)}>
              <Icon name="edit" size={20} />
            </button>
          </div>
        ))}

      {editing ? (
        <SupplyEdit supply={s} onClose={() => setEditing(false)} />
      ) : (
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="status-label">Peso do saco</div>
            <div className="status-detail">{s.gramsPerSack ? formatKg(s.gramsPerSack / 1000) : 'Não informado'}</div>
          </div>
          <button className="btn btn-outline btn-icon" aria-label="Editar produto" onClick={() => setEditing(true)}>
            <Icon name="edit" size={20} />
          </button>
        </div>
      )}

      {form === 'mistura' ? (
        <MixtureForm mixture={s} supplies={data.rows} onClose={() => setForm(null)} />
      ) : form ? (
        <MovementForm key={form} supply={s} type={form} onClose={() => setForm(null)} />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {!usedBy && (
            <button className="btn btn-primary btn-block" onClick={() => setForm('consumo')} disabled={pastures.length === 0}>
              <Icon name="pasture" /> Consumo no cocho
            </button>
          )}
          {mixture && (
            <button className="btn btn-gold btn-block" onClick={() => setForm('mistura')}>
              <Icon name="refresh" /> Mistura feita
            </button>
          )}
          <div className="row">
            {!mixture && (
              <button className={`btn ${usedBy ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => setForm('compra')}>
                <Icon name="plus" /> Compra
              </button>
            )}
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setForm('ajuste')}>
              <Icon name="edit" /> Ajuste
            </button>
          </div>
        </div>
      )}

      <h2 className="section-title">Entradas e saídas</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="supply-history">
        {history.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0' }}>
            Nenhum lançamento ainda.
          </p>
        ) : (
          history.map((m) => (
            <div className={`task${m.status === 'estornado' ? ' reversed' : ''}`} key={m.id}>
              <div className="status-body">
                <div className="status-label">
                  <span className={m.halfSacks > 0 ? 'delta-plus' : 'delta-minus'}>
                    {m.halfSacks > 0 ? '+' : '−'}
                    {formatSacks(Math.abs(m.halfSacks))}
                  </span>{' '}
                  · {movLabel(m)}
                  {m.type === 'consumo' && m.pastureId && ` · ${pastureName.get(m.pastureId) ?? 'pasto removido'}`}
                  {m.status === 'estornado' && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Estornado</span>}
                  {m.authorizedNegative && <span className="badge badge-gold" style={{ marginLeft: 8 }}>Autorizado</span>}
                </div>
                <div className="status-detail">
                  {formatDay(m.date)}
                  {m.type === 'compra' && m.costCents !== null && ` · ${formatMoney(m.costCents)} · ${m.supplier}`}
                  {m.notes && ` · ${m.notes}`}
                  {m.status === 'estornado' && m.reverseReason && ` · estorno: ${m.reverseReason}`}
                </div>
              </div>
              {m.status === 'ativo' && (
                <button className="btn btn-danger btn-icon" aria-label={`Estornar ${movLabel(m)} de ${formatSacks(Math.abs(m.halfSacks))}`} onClick={() => reverse(m)}>
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

function RecipeEdit({ mixture, supplies, onClose }: { mixture: Supply; supplies: Supply[]; onClose: () => void }) {
  const candidates = supplies.filter((x) => !isMixture(x) && x.deletedAt === null && (x.active || mixture.recipe?.some((r) => r.supplyId === x.id)))
  const initial = new Map((mixture.recipe ?? []).map((r) => [r.supplyId, String(r.halves / 2).replace('.', ',')]))
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(candidates.map((c) => [c.id, initial.get(c.id) ?? ''])))
  const [yieldText, setYieldText] = useState(mixture.yieldHalves ? String(mixture.yieldHalves / 2).replace('.', ',') : '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const recipe = candidates.filter((c) => qty[c.id]?.trim() && qty[c.id].trim() !== '0').map((c) => ({ supplyId: c.id, halves: parseSacks(qty[c.id]) }))
      await setRecipe(db, mixture.id, recipe, parseSacks(yieldText))
      onClose()
    } catch (err) {
      setError(err instanceof SupplyError ? err.message : (err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack" data-testid="recipe-form">
      <div className="status-label">Receita de uma mistura</div>
      <p className="muted" style={{ margin: 0 }}>
        Quantos sacos de cada produto entram em uma mistura e quantos sacos de mistura ela rende. Vale para as próximas misturas; as já lançadas não mudam.
      </p>
      {candidates.map((c) => (
        <div className="field" key={c.id} style={{ margin: 0 }}>
          <label className="label" htmlFor={`rc-${c.id}`}>
            {c.name} (sacos)
          </label>
          <input id={`rc-${c.id}`} className="input" inputMode="decimal" placeholder="0" value={qty[c.id] ?? ''} onChange={(e) => setQty({ ...qty, [c.id]: e.target.value })} />
        </div>
      ))}
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="rc-yield">
          Rende (sacos de mistura)
        </label>
        <input id="rc-yield" className="input" inputMode="decimal" value={yieldText} onChange={(e) => setYieldText(e.target.value)} />
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
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
          <Icon name="check" /> Salvar receita
        </button>
      </div>
    </form>
  )
}

function MixtureForm({ mixture, supplies, onClose }: { mixture: Supply; supplies: SupplyRow[]; onClose: () => void }) {
  const { farm } = useFarm()
  const [key] = useState(newId)
  const [batches, setBatches] = useState('1')
  const [date, setDate] = useState(todayLocal)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [negative, setNegative] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const n = /^\d+$/.test(batches.trim()) ? Number(batches) : 0
  const stock = new Map(supplies.map((r) => [r.supply.id, r]))

  async function save(authorizeReason?: string) {
    setError(null)
    setSaving(true)
    try {
      await recordMixture(db, farm.id, { mixtureId: mixture.id, batches: n, date, notes }, key, authorizeReason ? { reason: authorizeReason } : undefined)
      onClose()
    } catch (err) {
      setSaving(false)
      if (err instanceof NegativeStockError) setNegative(err.message)
      else setError(err instanceof SupplyError ? err.message : (err as Error).message)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      className="card stack"
      data-testid="mixture-form"
    >
      <div className="status-label">Mistura feita · {mixture.name}</div>
      <div className="field">
        <label className="label" htmlFor="mx-batches">
          Quantas misturas
        </label>
        <input id="mx-batches" className="input" inputMode="numeric" value={batches} onChange={(e) => setBatches(e.target.value.replace(/\D/g, ''))} />
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          {['1', '2', '3', '4'].map((v) => (
            <button type="button" key={v} className={`chip${batches === v ? ' active' : ''}`} onClick={() => setBatches(v)}>
              {v}
            </button>
          ))}
        </div>
      </div>
      {n > 0 && (
        <div data-testid="mixture-preview">
          {(mixture.recipe ?? []).map((r) => {
            const row = stock.get(r.supplyId)
            const need = r.halves * n
            const short = row ? row.halves < need : true
            return (
              <div className="cat-line" key={r.supplyId}>
                <span>
                  Sai {row?.supply.name ?? '—'} <span className="muted">(há {formatSacks(row?.halves ?? 0)})</span>
                </span>
                <span className="num" style={{ color: short ? 'var(--warn)' : undefined }}>
                  −{formatSacks(need)}
                </span>
              </div>
            )
          })}
          <div className="cat-line">
            <strong>Entra {mixture.name}</strong>
            <span className="num delta-plus">+{formatSacks((mixture.yieldHalves ?? 0) * n)}</span>
          </div>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="mx-date">
          Data
        </label>
        <input id="mx-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="mx-notes">
          Observação
        </label>
        <input id="mx-notes" className="input" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      {negative ? (
        <NegativeAuthorization message={negative} onCancel={() => setNegative(null)} onAuthorize={(reason) => void save(reason)} />
      ) : (
        <div className="row">
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving || n <= 0}>
            <Icon name="check" /> Registrar
          </button>
        </div>
      )}
    </form>
  )
}

function SupplyEdit({ supply, onClose }: { supply: Supply; onClose: () => void }) {
  const [name, setName] = useState(supply.name)
  const [kg, setKg] = useState(supply.gramsPerSack ? String(supply.gramsPerSack / 1000).replace('.', ',') : '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await updateSupply(db, supply, name, kg.trim() ? parseKgPerSack(kg) : null)
      onClose()
    } catch (err) {
      setError(err instanceof SupplyError ? err.message : (err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack">
      <div className="field">
        <label className="label" htmlFor="sup-edit-name">
          Nome do produto
        </label>
        <input id="sup-edit-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="sup-edit-kg">
          Peso do saco (kg)
        </label>
        <input id="sup-edit-kg" className="input" inputMode="decimal" placeholder="Ex.: 25" value={kg} onChange={(e) => setKg(e.target.value)} />
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
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
          <Icon name="check" /> Salvar
        </button>
      </div>
      <button type="button" className="btn btn-outline btn-block" onClick={() => setSupplyActive(db, supply.id, !supply.active).then(onClose)}>
        {supply.active ? 'Desativar produto' : 'Reativar produto'}
      </button>
    </form>
  )
}

function MovementForm({ supply, type, onClose }: { supply: Supply; type: SupplyMovementInput['type']; onClose: () => void }) {
  const { farm } = useFarm()
  const pastures = usePastures() ?? []
  const [key] = useState(newId)
  const [date, setDate] = useState(todayLocal)
  const [sacks, setSacks] = useState('')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const [pastureId, setPastureId] = useState('')
  const [direction, setDirection] = useState<'entrada' | 'saida' | ''>('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [negative, setNegative] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function input(): SupplyMovementInput {
    return {
      supplyId: supply.id,
      type,
      date,
      halves: parseSacks(sacks),
      costCents: type === 'compra' ? parseMoney(cost) : null,
      supplier,
      pastureId: type === 'consumo' ? pastureId || null : null,
      direction: type === 'ajuste' ? direction || undefined : undefined,
      notes,
    }
  }

  async function save(authorizeReason?: string) {
    setError(null)
    setSaving(true)
    try {
      await recordSupplyMovement(db, farm.id, input(), key, authorizeReason ? { reason: authorizeReason } : undefined)
      onClose()
    } catch (err) {
      setSaving(false)
      if (err instanceof NegativeStockError) setNegative(err.message)
      else setError(err instanceof SupplyError ? err.message : (err as Error).message)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void save()
  }

  const kgPreview = (() => {
    try {
      return supply.gramsPerSack && sacks.trim() ? formatKg(sacksToKg(parseSacks(sacks), supply.gramsPerSack)) : null
    } catch {
      return null
    }
  })()

  return (
    <form onSubmit={submit} className="card stack" data-testid="supply-form">
      <div className="status-label">
        {TYPE_LABEL[type]} · {supply.name}
      </div>
      {type === 'ajuste' && (
        <div className="row">
          {(['entrada', 'saida'] as const).map((d) => (
            <button type="button" key={d} className={`chip${direction === d ? ' active' : ''}`} style={{ flex: 1 }} onClick={() => setDirection(d)}>
              {d === 'entrada' ? 'Entrada (+)' : 'Saída (−)'}
            </button>
          ))}
        </div>
      )}
      {type === 'consumo' && (
        <div className="field">
          <label className="label" htmlFor="mv-pasture">
            Pasto (cocho)
          </label>
          <select id="mv-pasture" className="input" value={pastureId} onChange={(e) => setPastureId(e.target.value)}>
            <option value="">Escolha o pasto</option>
            {pastures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="mv-sacks">
          Quantidade (sacos)
        </label>
        <input id="mv-sacks" className="input" inputMode="decimal" placeholder="Ex.: 1; 0,5; 2,5" value={sacks} onChange={(e) => setSacks(e.target.value)} />
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {['0,5', '1', '1,5', '2'].map((v) => (
            <button type="button" key={v} className={`chip${sacks === v ? ' active' : ''}`} onClick={() => setSacks(v)}>
              {v}
            </button>
          ))}
        </div>
        {kgPreview && <p className="muted" style={{ margin: '6px 0 0' }}>= {kgPreview}</p>}
      </div>
      <div className="field">
        <label className="label" htmlFor="mv-date">
          Data
        </label>
        <input id="mv-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
      </div>
      {type === 'compra' && (
        <>
          <div className="field">
            <label className="label" htmlFor="mv-cost">
              Valor pago (total)
            </label>
            <input id="mv-cost" className="input" inputMode="decimal" placeholder="R$ 0,00" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="mv-supplier">
              Fornecedor
            </label>
            <input id="mv-supplier" className="input" maxLength={80} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
        </>
      )}
      <div className="field">
        <label className="label" htmlFor="mv-notes">
          {type === 'ajuste' ? 'Motivo do ajuste (obrigatório)' : 'Observação'}
        </label>
        <input id="mv-notes" className="input" maxLength={200} placeholder={type === 'ajuste' ? 'Ex.: saco rasgado, contagem do depósito' : ''} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      {negative ? (
        <NegativeAuthorization message={negative} onCancel={() => setNegative(null)} onAuthorize={(reason) => void save(reason)} />
      ) : (
        <div className="row">
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving || !sacks.trim()}>
            <Icon name="check" /> Registrar
          </button>
        </div>
      )}
    </form>
  )
}

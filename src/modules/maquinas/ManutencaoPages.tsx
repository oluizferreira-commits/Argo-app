import { useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { newId } from '../../core/ids'
import { formatMoney, parseDecimal, parseMoney } from '../../core/money'
import { db } from '../../db/database'
import type { ChecklistStatus } from '../../db/types'
import { Icon } from '../../components/Icon'
import { NegativeAuthorization } from '../../components/NegativeAuthorization'
import { useFarm } from '../fazendas/FarmContext'
import { formatQty, isMixture, NegativeStockError, parseQty, supplyStock, UNIT_LABEL, unitOf } from '../insumos/supplies'
import { todayLocal } from '../rebanho/herd'
import { formatMeterH } from './machines'
import { CHECK_LABEL, DEFAULT_CHECKLIST, MAINTENANCE_SUGGESTIONS, recordMaintenance, saveChecklist, setChecklistItems } from './maintenance'
import { compressPhoto } from './photo'
import { useMaquinas, type MaquinasData } from './useMaquinas'

interface PartLine {
  key: string
  fromStock: boolean
  supplyId: string
  qty: string
  description: string
  value: string
}

/** Registrar manutenção (de um plano, de uma solicitação ou avulsa). */
export function ManutencaoPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const data = useMaquinas()
  if (!data) return null
  const eq = data.equipmentById.get(id ?? '')
  if (!eq) return <p className="muted">Máquina não encontrada.</p>
  const plan = data.plans.find((p) => p.id === params.get('plano') && p.equipmentId === eq.id)
  const request = data.records.find((r) => r.id === params.get('solicitacao') && r.status === 'solicitada')
  return <MaintenanceForm key={plan?.id ?? request?.id ?? 'avulsa'} data={data} eqId={eq.id} planId={plan?.id ?? null} requestId={request?.id} initialKind={plan?.name ?? request?.kind ?? ''} problem={request?.problem ?? ''} />
}

function MaintenanceForm({
  data,
  eqId,
  planId,
  requestId,
  initialKind,
  problem,
}: {
  data: MaquinasData
  eqId: string
  planId: string | null
  requestId?: string
  initialKind: string
  problem: string
}) {
  const { farm } = useFarm()
  const navigate = useNavigate()
  const eq = data.equipmentById.get(eqId)!
  const meterNow = data.meterOf(eq)
  const [key] = useState(newId)
  const [kind, setKind] = useState(initialKind)
  const [date, setDate] = useState(todayLocal)
  const [meter, setMeter] = useState(meterNow === null ? '' : (meterNow / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }).replace(/\./g, ''))
  const [responsibleId, setResponsibleId] = useState(eq.responsibleId ?? '')
  const [parts, setParts] = useState<PartLine[]>([])
  const [service, setService] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [negative, setNegative] = useState<string | null>(null)
  const stock = data.supplies.filter((s) => s.deletedAt === null && s.active && !isMixture(s)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const people = data.responsibles.filter((r) => r.deletedAt === null && r.active)
  const upd = (k: string, patch: Partial<PartLine>) => setParts(parts.map((p) => (p.key === k ? { ...p, ...patch } : p)))
  const direct = parts.filter((p) => !p.fromStock).reduce((a, p) => a + (parseMoney(p.value) ?? 0), 0) + (parseMoney(service) ?? 0)

  async function save(authorizeReason?: string) {
    setError(null)
    try {
      const m = meter.trim() ? parseDecimal(meter, 2) : null
      if (meter.trim() && m === null) throw new Error('Horímetro inválido.')
      const r = await recordMaintenance(
        db,
        farm.id,
        {
          equipmentId: eq.id,
          planId,
          kind,
          date,
          meter: m,
          responsibleId: responsibleId || null,
          parts: parts.map((p) => {
            const s = data.supplies.find((x) => x.id === p.supplyId)
            return p.fromStock ? { supplyId: p.supplyId || null, description: '', qty: s ? parseQty(p.qty, unitOf(s)) : null, costCents: null } : { supplyId: null, description: p.description, qty: null, costCents: parseMoney(p.value) }
          }),
          serviceCents: parseMoney(service) ?? 0,
          notes,
        },
        key,
        { requestId, authorize: authorizeReason ? { reason: authorizeReason } : undefined },
      )
      void r
      navigate(`/maquinas/${eq.id}`, { replace: true })
    } catch (err) {
      if (err instanceof NegativeStockError) setNegative(err.message)
      else setError((err as Error).message)
    }
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        void save()
      }}
      className="stack"
      data-testid="maintenance-form"
    >
      <div className="card stack">
        <div className="status-label">{eq.name}</div>
        {problem && (
          <div className="notice notice-warn">
            <Icon name="alert" />
            <div>Problema informado: {problem}</div>
          </div>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="mt-kind">
            Tipo de manutenção
          </label>
          <input id="mt-kind" className="input" list="mt-suggest" maxLength={60} value={kind} onChange={(e) => setKind(e.target.value)} />
          <datalist id="mt-suggest">
            {MAINTENANCE_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label className="label" htmlFor="mt-date">
              Data
            </label>
            <input id="mt-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label className="label" htmlFor="mt-meter">
              Horímetro
            </label>
            <input id="mt-meter" className="input" inputMode="decimal" value={meter} onChange={(e) => setMeter(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="mt-resp">
            Responsável
          </label>
          <select id="mt-resp" className="input" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
            <option value="">Nenhum</option>
            {people.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h2 className="section-title">Peças, óleo e filtros</h2>
      <div className="card stack" data-testid="mt-parts">
        {parts.map((p, i) => {
          const s = data.supplies.find((x) => x.id === p.supplyId)
          return (
            <div key={p.key} className="op-line">
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className={`chip${p.fromStock ? ' active' : ''}`} onClick={() => upd(p.key, { fromStock: true })}>
                  Do estoque
                </button>
                <button type="button" className={`chip${!p.fromStock ? ' active' : ''}`} onClick={() => upd(p.key, { fromStock: false })}>
                  Comprado agora
                </button>
                <button type="button" className="btn btn-outline btn-icon" style={{ marginLeft: 'auto' }} aria-label={`Remover item ${i + 1}`} onClick={() => setParts(parts.filter((x) => x.key !== p.key))}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
              {p.fromStock ? (
                <div className="row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
                  <select className="input" style={{ flex: 2 }} aria-label={`Produto ${i + 1}`} value={p.supplyId} onChange={(e) => upd(p.key, { supplyId: e.target.value })}>
                    <option value="">Produto do estoque</option>
                    {stock.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} · {formatQty(supplyStock(data.supplyMovements, o.id), unitOf(o))}
                      </option>
                    ))}
                  </select>
                  <input className="input" style={{ flex: 1 }} inputMode="decimal" aria-label={`Quantidade ${i + 1}`} placeholder={s ? UNIT_LABEL[unitOf(s)] : 'Qtde'} value={p.qty} onChange={(e) => upd(p.key, { qty: e.target.value })} />
                </div>
              ) : (
                <div className="row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
                  <input className="input" style={{ flex: 2 }} aria-label={`Descrição ${i + 1}`} placeholder="Ex.: filtro de óleo" maxLength={80} value={p.description} onChange={(e) => upd(p.key, { description: e.target.value })} />
                  <input className="input" style={{ flex: 1 }} inputMode="decimal" aria-label={`Valor ${i + 1}`} placeholder="R$" value={p.value} onChange={(e) => upd(p.key, { value: e.target.value })} />
                </div>
              )}
            </div>
          )
        })}
        <button type="button" className="btn btn-outline btn-block" onClick={() => setParts([...parts, { key: newId(), fromStock: true, supplyId: '', qty: '', description: '', value: '' }])} data-testid="add-part">
          <Icon name="plus" /> Adicionar peça, óleo ou filtro
        </button>
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="mt-service">
            Mão de obra / oficina (valor pago)
          </label>
          <input id="mt-service" className="input" inputMode="decimal" placeholder="R$ 0,00" value={service} onChange={(e) => setService(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="mt-notes">
            Observações
          </label>
          <textarea id="mt-notes" className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Peças do estoque dão baixa pelo custo médio (já foram despesa na compra). Comprado agora + mão de obra = {formatMoney(direct)} de despesa.
        </p>
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      {negative ? (
        <NegativeAuthorization message={negative} onCancel={() => setNegative(null)} onAuthorize={(r) => void save(r)} />
      ) : (
        <button type="submit" className="btn btn-primary btn-block" disabled={!kind.trim()} data-testid="save-maintenance">
          <Icon name="check" /> Concluir manutenção
        </button>
      )}
      {meterNow !== null && <p className="muted" style={{ margin: '0 4px', fontSize: 13 }}>Horímetro atual da máquina: {formatMeterH(meterNow)}</p>}
    </form>
  )
}

/** Checklist diário: todos os itens precisam ser marcados. */
export function ChecklistPage() {
  const { id } = useParams()
  const data = useMaquinas()
  const { farm } = useFarm()
  const navigate = useNavigate()
  const labels = farm.checklistItems?.length ? farm.checklistItems : DEFAULT_CHECKLIST
  const [key] = useState(newId)
  const [items, setItems] = useState(() => labels.map((label) => ({ label, status: '' as ChecklistStatus | '', note: '' })))
  const [photos, setPhotos] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [responsibleId, setResponsibleId] = useState('')
  const [openRequest, setOpenRequest] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [itemsText, setItemsText] = useState(labels.join('\n'))
  const [todayText] = useState(() => new Date().toLocaleDateString('pt-BR'))
  if (!data) return null
  const eq = data.equipmentById.get(id ?? '')
  if (!eq) return <p className="muted">Máquina não encontrada.</p>
  const people = data.responsibles.filter((r) => r.deletedAt === null && r.active)
  const done = items.filter((i) => i.status).length
  const problems = items.filter((i) => i.status === 'problema').length

  async function addPhotos(files: FileList | null) {
    if (!files) return
    try {
      const list = await Promise.all([...files].slice(0, 6 - photos.length).map((f) => compressPhoto(f)))
      setPhotos([...photos, ...list])
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await saveChecklist(db, farm.id, { equipmentId: eq!.id, responsibleId: responsibleId || null, items, photos, notes, openRequest }, key)
      navigate(`/maquinas/${eq!.id}`, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (editing)
    return (
      <div className="card stack" data-testid="checklist-items-editor">
        <div className="status-label">Itens do checklist (um por linha)</div>
        <textarea className="input" rows={12} value={itemsText} onChange={(e) => setItemsText(e.target.value)} />
        <div className="row">
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditing(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={async () => {
              await setChecklistItems(db, farm.id, itemsText.split('\n'))
              setEditing(false)
              navigate(0)
            }}
          >
            Salvar itens
          </button>
        </div>
      </div>
    )

  return (
    <form onSubmit={submit} className="stack" data-testid="checklist-form">
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="status-label">
            {eq.name} · {todayText}
          </div>
          <span className="badge badge-neutral" data-testid="checklist-progress">
            {done}/{items.length}
          </span>
        </div>
        <select className="input" aria-label="Responsável pela inspeção" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
          <option value="">Responsável pela inspeção</option>
          {people.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="card stack" data-testid="checklist-items">
        {items.map((it, i) => (
          <div key={it.label} className="op-line">
            <div className="status-label" style={{ marginBottom: 6 }}>
              {it.label}
            </div>
            <div className="check-opts" role="group" aria-label={it.label}>
              {(['ok', 'atencao', 'problema', 'na'] as const).map((st) => (
                <button
                  type="button"
                  key={st}
                  className={`check-opt check-${st}${it.status === st ? ' active' : ''}`}
                  aria-pressed={it.status === st}
                  onClick={() => {
                    setError(null)
                    setItems(items.map((x, k) => (k === i ? { ...x, status: st } : x)))
                  }}
                >
                  {CHECK_LABEL[st]}
                </button>
              ))}
            </div>
            {(it.status === 'atencao' || it.status === 'problema') && (
              <input className="input" style={{ marginTop: 6 }} aria-label={`Observação de ${it.label}`} placeholder="O que foi visto?" maxLength={300} value={it.note} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} />
            )}
          </div>
        ))}
      </div>
      <div className="card stack">
        <label className="btn btn-outline btn-block" style={{ cursor: 'pointer' }}>
          <Icon name="upload" /> Adicionar foto ({photos.length}/6)
          <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={(e) => void addPhotos(e.target.files)} data-testid="photo-input" />
        </label>
        {photos.length > 0 && (
          <div className="photo-grid">
            {photos.map((p, k) => (
              <button type="button" key={k} className="status-link" aria-label={`Remover foto ${k + 1}`} onClick={() => setPhotos(photos.filter((_, j) => j !== k))}>
                <img src={p} alt={`Foto ${k + 1}`} />
              </button>
            ))}
          </div>
        )}
        <textarea className="input" aria-label="Observações" placeholder="Observações gerais" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {problems > 0 && (
          <label className="row" style={{ gap: 10 }}>
            <input type="checkbox" checked={openRequest} onChange={(e) => setOpenRequest(e.target.checked)} style={{ width: 22, height: 22 }} />
            <span>Abrir solicitação de manutenção ({problems} problema(s))</span>
          </label>
        )}
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-block" data-testid="save-checklist">
        <Icon name="check" /> Concluir inspeção
      </button>
      <button type="button" className="btn btn-outline btn-block" onClick={() => setEditing(true)}>
        Personalizar itens do checklist
      </button>
    </form>
  )
}

import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { newId } from '../../core/ids'
import { formatMoney, parseDecimal, parseMoney } from '../../core/money'
import { db } from '../../db/database'
import type { FieldOperation, FieldOperationType, MachineSession } from '../../db/types'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../../components/Icon'
import { NegativeAuthorization } from '../../components/NegativeAuthorization'
import { FuelNegativeError, fuelLedger, parseLiters, parseMeter } from '../diesel/fuel'
import { useFarm } from '../fazendas/FarmContext'
import { verifyPin } from '../fazendas/farms'
import { categoryOf, formatQty, isMixture, NegativeStockError, parseQty, supplyLedger, supplyStock, UNIT_LABEL, unitOf } from '../insumos/supplies'
import { todayLocal } from '../rebanho/herd'
import { createOperation, formatHa, OPERATION_TYPES, OperationError, PASTURE_OPTIONAL, type OperationInput } from './operations'
import { formatHoursMinutes, sessionSeconds } from '../maquinas/machines'
import { useDiaristas } from '../diaristas/useDiaristas'
import { halfValue, workDayId } from '../diaristas/workers'
import { useManejo, type ManejoData } from './useManejo'

interface ProductLine {
  key: string
  supplyId: string
  qty: string
  lot: string
}
interface EquipLine {
  key: string
  /** horímetro digital: horas da sessão (não editáveis aqui) */
  sessionId?: string
  sessionSeconds?: number
  equipmentId: string
  responsibleId: string
  meterStart: string
  meterEnd: string
  hours: string
  diesel: string
}
interface CostLine {
  key: string
  description: string
  value: string
}

/** data local (AAAA-MM-DD) de um horário ISO */
const localDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dec = (scaled: number, places: number) => (scaled / 10 ** places).toLocaleString('pt-BR', { maximumFractionDigits: places }).replace(/\./g, '')
const tryOr = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export function OperacaoFormPage() {
  const data = useManejo()
  const [params] = useSearchParams()
  const serviceId = params.get('servico')
  const sessions = useLiveQuery(async () => (serviceId ? db.machineSessions.where('serviceId').equals(serviceId).toArray() : []), [serviceId])
  if (!data || !sessions) return null
  const fix = data.operations.find((o) => o.id === params.get('corrigir') && o.status === 'concluida')
  const service = sessions.filter((x) => x.status === 'encerrada' && !x.operationId && x.deletedAt === null)
  const type = (OPERATION_TYPES.find((t) => t.id === params.get('tipo'))?.id ?? fix?.type ?? service[0]?.serviceType ?? 'herbicida') as FieldOperationType
  return <Form key={fix?.id ?? serviceId ?? type} data={data} initialType={type} initialPasture={params.get('pasto') ?? service[0]?.pastureId ?? ''} fix={fix} service={service} />
}

function Form({
  data,
  initialType,
  initialPasture,
  fix,
  service,
}: {
  data: ManejoData
  initialType: FieldOperationType
  initialPasture: string
  fix: FieldOperation | undefined
  service: MachineSession[]
}) {
  const { farm } = useFarm()
  const navigate = useNavigate()
  const [key] = useState(newId)
  const pastures = data.pastures.filter((p) => p.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
  const equipments = data.equipments.filter((e) => e.deletedAt === null && (e.active || fix?.equipments.some((x) => x.equipmentId === e.id)))
  const people = data.responsibles.filter((r) => r.deletedAt === null && r.active)
  const [type, setType] = useState<FieldOperationType>(initialType)
  const [date, setDate] = useState(fix?.date ?? (service[0] ? localDate(service[0].startedAt) : todayLocal()))
  const [customType, setCustomType] = useState(fix?.customType ?? service[0]?.customType ?? '')
  const [location, setLocation] = useState(fix?.location ?? service[0]?.location ?? '')
  const [pastureId, setPastureId] = useState(fix?.pastureId ?? initialPasture)
  const areaOf = (id: string) => data.pastureById.get(id)?.areaHa ?? null
  const [area, setArea] = useState(fix ? dec(fix.workedAreaCentiHa, 2) : initialPasture && areaOf(initialPasture) !== null ? dec(Math.round(areaOf(initialPasture)! * 100), 2) : '')
  const [areaTouched, setAreaTouched] = useState(Boolean(fix))
  const [responsibleId, setResponsibleId] = useState(fix?.responsibleId ?? '')
  const [products, setProducts] = useState<ProductLine[]>(
    fix ? fix.products.map((p) => ({ key: newId(), supplyId: p.supplyId, qty: p.unit === 'saco' ? dec(p.qty * 50, 2) : dec(p.qty, 3), lot: p.lot ?? '' })) : [{ key: newId(), supplyId: '', qty: '', lot: '' }],
  )
  const [equips, setEquips] = useState<EquipLine[]>(
    service.length
      ? service.map((x) => ({
          key: newId(),
          sessionId: x.id,
          sessionSeconds: sessionSeconds(x),
          equipmentId: x.equipmentId,
          responsibleId: x.responsibleId ?? '',
          meterStart: '',
          meterEnd: '',
          hours: '',
          diesel: '',
        }))
      : fix
      ? fix.equipments.map((e) => ({
          key: newId(),
          sessionId: e.sessionId ?? undefined,
          sessionSeconds: e.sessionSeconds ?? undefined,
          equipmentId: e.equipmentId,
          responsibleId: e.responsibleId ?? '',
          meterStart: e.meterStart === null ? '' : dec(e.meterStart, 1),
          meterEnd: e.meterEnd === null ? '' : dec(e.meterEnd, 1),
          hours: e.hoursTenths === null || (e.meterStart !== null && e.meterEnd !== null) ? '' : dec(e.hoursTenths, 1),
          diesel: e.dieselCl ? dec(e.dieselCl, 2) : '',
        }))
      : [],
  )
  const [costs, setCosts] = useState<CostLine[]>(fix ? fix.otherCosts.map((c) => ({ key: newId(), description: c.description, value: dec(c.costCents, 2) })) : [])
  const [notes, setNotes] = useState(fix?.notes ?? '')
  const diaristas = useDiaristas()
  const [workers, setWorkers] = useState<{ key: string; workerId: string; kind: 'integral' | 'meia' }[]>(
    (fix?.workers ?? []).map((w) => ({ key: newId(), workerId: w.workerId, kind: w.kind })),
  )
  const [fixReason, setFixReason] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [negative, setNegative] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const seedsOnly = type === 'plantio' || type === 'replantio'
  const productOptions = data.supplies
    .filter((s) => s.deletedAt === null && !isMixture(s) && (s.active || products.some((p) => p.supplyId === s.id)))
    .filter((s) => (seedsOnly ? categoryOf(s) === 'semente' : type === 'herbicida' ? categoryOf(s) === 'herbicida' : true))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

  // custo médio de referência (o custo final é calculado ao gravar, pelo estoque na data)
  const fuel = useMemo(() => fuelLedger(data.fuelMovements), [data.fuelMovements])
  const lineCost = (l: ProductLine): number | null => {
    const s = data.supplyById.get(l.supplyId)
    if (!s || !l.qty.trim()) return null
    const q = tryOr(() => parseQty(l.qty, unitOf(s)), null)
    if (q === null) return null
    const led = supplyLedger(data.supplyMovements, s.id)
    return led.balance > 0 ? Math.round((led.valueCents * q) / led.balance) : 0
  }
  const dieselCostOf = (l: EquipLine) => {
    const cl = l.diesel.trim() ? tryOr(() => parseLiters(l.diesel), 0) : 0
    return Math.round((cl * fuel.avgCents) / 100)
  }
  const prodSum = (sem: boolean) =>
    products.filter((l) => (categoryOf(data.supplyById.get(l.supplyId) ?? {}) === 'semente') === sem).reduce((a, l) => a + (lineCost(l) ?? 0), 0)
  const seeds = prodSum(true)
  const herb = prodSum(false)
  const diesel = equips.reduce((a, l) => a + dieselCostOf(l), 0)
  const other = costs.reduce((a, c) => a + (parseMoney(c.value) ?? 0), 0)
  const dayOf = (workerId: string) => diaristas?.days.find((d) => d.id === workDayId(workerId, date) && d.deletedAt === null)
  const laborOf = (l: { workerId: string; kind: 'integral' | 'meia' }) => {
    const w = diaristas?.workers.find((x) => x.id === l.workerId)
    if (!w) return 0
    const d = dayOf(w.id)
    if (d && (d.kind === 'integral' || d.kind === 'meia')) return d.valueCents
    return l.kind === 'integral' ? w.dailyCents : halfValue(w)
  }
  const labor = workers.reduce((a, l) => a + laborOf(l), 0)
  const total = seeds + herb + diesel + other + labor
  const areaC = parseDecimal(area, 2) ?? 0
  const seedKg = products.reduce((a, l) => {
    const s = data.supplyById.get(l.supplyId)
    return s && categoryOf(s) === 'semente' && unitOf(s) === 'kg' ? a + tryOr(() => parseQty(l.qty, 'kg'), 0) : a
  }, 0)

  function choosePasture(id: string) {
    setPastureId(id)
    const a = areaOf(id)
    if (!areaTouched) setArea(a === null ? '' : dec(Math.round(a * 100), 2))
  }

  function buildInput(): OperationInput {
    const centi = parseDecimal(area, 2) ?? 0
    if (pastureId && !centi) throw new OperationError('Informe a área trabalhada (ha).')
    return {
      type,
      customType,
      location,
      date,
      pastureId,
      workedAreaCentiHa: centi,
      responsibleId: responsibleId || null,
      products: products
        .filter((l) => l.supplyId || l.qty.trim())
        .map((l) => {
          const s = data.supplyById.get(l.supplyId)
          if (!s) throw new OperationError('Escolha o produto de cada linha.')
          return { supplyId: s.id, qty: parseQty(l.qty, unitOf(s)), lot: l.lot }
        }),
      equipments: equips.map((l) => ({
        equipmentId: l.equipmentId,
        responsibleId: l.responsibleId || null,
        meterStart: l.sessionId ? null : parseMeter(l.meterStart),
        meterEnd: l.sessionId ? null : parseMeter(l.meterEnd),
        hoursTenths: l.sessionId ? null : l.hours.trim() ? (parseDecimal(l.hours, 1) ?? NaN) : null,
        dieselCl: l.diesel.trim() ? parseLiters(l.diesel) : 0,
        sessionId: l.sessionId ?? null,
      })),
      otherCosts: costs.filter((c) => c.description.trim() || c.value.trim()).map((c) => ({ description: c.description, costCents: parseMoney(c.value) ?? 0 })),
      workers: workers.filter((l) => l.workerId).map((l) => ({ workerId: l.workerId, kind: l.kind })),
      notes,
    }
  }

  async function save(authorizeReason?: string) {
    setError(null)
    setSaving(true)
    try {
      const input = buildInput()
      if (fix) {
        if (!fixReason.trim()) throw new OperationError('Informe o motivo da correção.')
        if (!(await verifyPin(farm, pin))) throw new OperationError('PIN da fazenda incorreto.')
      }
      const op = await createOperation(db, farm.id, input, key, {
        authorize: authorizeReason ? { reason: authorizeReason } : undefined,
        replacesId: fix?.id,
        correctionReason: fix ? fixReason : undefined,
      })
      navigate(`/manejo/${op.id}`, { replace: true })
    } catch (err) {
      setSaving(false)
      if (err instanceof NegativeStockError || err instanceof FuelNegativeError) setNegative(err.message)
      else setError((err as Error).message)
    }
  }

  const upd = <T extends { key: string }>(list: T[], set: (v: T[]) => void, k: string, patch: Partial<T>) => set(list.map((x) => (x.key === k ? { ...x, ...patch } : x)))
  const pasture = data.pastureById.get(pastureId)

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        void save()
      }}
      className="stack"
      data-testid="operation-form"
    >
      {fix && (
        <div className="notice notice-warn">
          <Icon name="edit" />
          <div>
            Corrigindo a <strong>operação nº {String(fix.number).padStart(4, '0')}</strong>. Ao salvar, ela é cancelada (produtos e diesel voltam ao estoque) e esta nova operação a substitui. Tudo fica no histórico.
          </div>
        </div>
      )}
      <div className="card stack">
        <div className="chips chips-wrap" role="group" aria-label="Tipo de operação">
          {OPERATION_TYPES.map((t) => (
            <button type="button" key={t.id} className={`chip${type === t.id ? ' active' : ''}`} aria-pressed={type === t.id} onClick={() => setType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label className="label" htmlFor="op-date">
              Data
            </label>
            <input id="op-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label className="label" htmlFor="op-area">
              Área trabalhada (ha)
            </label>
            <input
              id="op-area"
              className="input"
              inputMode="decimal"
              value={area}
              onChange={(e) => {
                setArea(e.target.value)
                setAreaTouched(true)
              }}
            />
          </div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="op-pasture">
            Pasto
          </label>
          <select id="op-pasture" className="input" value={pastureId} onChange={(e) => choosePasture(e.target.value)}>
            <option value="">{PASTURE_OPTIONAL.includes(type) ? 'Fora de pasto (informar o local)' : 'Escolha o pasto'}</option>
            {pastures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.areaHa !== null ? ` (${formatHa(Math.round(p.areaHa * 100))})` : ''}
              </option>
            ))}
          </select>
          {pasture && (
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }} data-testid="op-area-info">
              Área do pasto: {pasture.areaHa === null ? 'não informada' : formatHa(Math.round(pasture.areaHa * 100))}
              {pasture.areaHa !== null && areaC > 0 && areaC < Math.round(pasture.areaHa * 100) ? ` · parcial (${Math.round((areaC * 100) / Math.round(pasture.areaHa * 100))}% do pasto)` : ''}
            </p>
          )}
        </div>
        {!pastureId && PASTURE_OPTIONAL.includes(type) && (
          <input className="input" aria-label="Local do serviço" placeholder="Local (ex.: sede → Redenção)" maxLength={80} value={location} onChange={(e) => setLocation(e.target.value)} />
        )}
        {type === 'outra' && (
          <input className="input" aria-label="Qual serviço" placeholder="Qual serviço? Ex.: conserto de cerca" maxLength={60} value={customType} onChange={(e) => setCustomType(e.target.value)} />
        )}
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="op-resp">
            Responsável pela operação
          </label>
          <select id="op-resp" className="input" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
            <option value="">{people.length ? 'Escolha (opcional)' : 'Nenhum cadastrado'}</option>
            {people.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h2 className="section-title">{seedsOnly ? 'Sementes usadas' : type === 'herbicida' ? 'Herbicidas usados' : 'Produtos usados'}</h2>
      <div className="card stack" data-testid="op-products">
        {productOptions.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            Nenhum produto em estoque desta categoria. Cadastre e lance a compra em Insumos ({seedsOnly ? 'Sementes' : 'Herbicidas'}).
          </p>
        )}
        {products.map((l, i) => {
          const s = data.supplyById.get(l.supplyId)
          const unit = s ? unitOf(s) : 'kg'
          const c = lineCost(l)
          return (
            <div key={l.key} className="op-line">
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 2, margin: 0 }}>
                  <label className="label" htmlFor={`op-p${i}`}>
                    Produto {i + 1}
                  </label>
                  <select id={`op-p${i}`} className="input" value={l.supplyId} onChange={(e) => upd(products, setProducts, l.key, { supplyId: e.target.value })}>
                    <option value="">Escolha</option>
                    {productOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} · {formatQty(supplyStock(data.supplyMovements, o.id), unitOf(o))}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="btn btn-outline btn-icon" aria-label={`Remover produto ${i + 1}`} onClick={() => setProducts(products.filter((x) => x.key !== l.key))}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
              <div className="row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
                <div className="field" style={{ flex: 1, margin: 0 }}>
                  <label className="label" htmlFor={`op-q${i}`}>
                    Quantidade ({UNIT_LABEL[unit]})
                  </label>
                  <input id={`op-q${i}`} className="input" inputMode="decimal" value={l.qty} onChange={(e) => upd(products, setProducts, l.key, { qty: e.target.value })} />
                </div>
                {s && categoryOf(s) === 'semente' && (
                  <div className="field" style={{ flex: 1, margin: 0 }}>
                    <label className="label" htmlFor={`op-l${i}`}>
                      Lote
                    </label>
                    <input id={`op-l${i}`} className="input" maxLength={40} value={l.lot} onChange={(e) => upd(products, setProducts, l.key, { lot: e.target.value })} />
                  </div>
                )}
              </div>
              {c !== null && (
                <p className="muted op-line-cost">
                  Custo de referência {formatMoney(c)}
                  {areaC > 0 && s && categoryOf(s) === 'semente' && unit === 'kg' ? ` · ${(tryOr(() => parseQty(l.qty, 'kg'), 0) / 1000 / (areaC / 100)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg/ha` : ''}
                </p>
              )}
            </div>
          )
        })}
        <button type="button" className="btn btn-outline btn-block" onClick={() => setProducts([...products, { key: newId(), supplyId: '', qty: '', lot: '' }])} data-testid="add-product">
          <Icon name="plus" /> {seedsOnly ? 'Outra semente / lote' : 'Outro produto (mistura)'}
        </button>
      </div>

      <h2 className="section-title">Tratores e equipamentos</h2>
      <div className="card stack" data-testid="op-equipments">
        {equipments.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            Nenhum equipamento cadastrado (Diesel → Equipamentos).
          </p>
        )}
        {equips.map((l, i) => {
          const eq = data.equipmentById.get(l.equipmentId)
          const meter = eq?.meter ?? 'nenhum'
          const ms = tryOr(() => parseMeter(l.meterStart), null)
          const me = tryOr(() => parseMeter(l.meterEnd), null)
          const auto = ms !== null && me !== null && me >= ms ? me - ms : null
          return (
            <div key={l.key} className="op-line">
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 2, margin: 0 }}>
                  <label className="label" htmlFor={`op-e${i}`}>
                    Equipamento {i + 1}
                  </label>
                  <select
                    id={`op-e${i}`}
                    className="input"
                    disabled={Boolean(l.sessionId)}
                    value={l.equipmentId}
                    onChange={(e) => upd(equips, setEquips, l.key, { equipmentId: e.target.value, responsibleId: data.equipmentById.get(e.target.value)?.responsibleId ?? l.responsibleId })}
                  >
                    <option value="">Escolha</option>
                    {equipments.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="btn btn-outline btn-icon" disabled={Boolean(l.sessionId)} aria-label={`Remover equipamento ${i + 1}`} onClick={() => setEquips(equips.filter((x) => x.key !== l.key))}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
              <div className="field" style={{ margin: '8px 0 0' }}>
                <label className="label" htmlFor={`op-er${i}`}>
                  Responsável pelo equipamento
                </label>
                <select id={`op-er${i}`} className="input" value={l.responsibleId} onChange={(e) => upd(equips, setEquips, l.key, { responsibleId: e.target.value })}>
                  <option value="">Nenhum</option>
                  {people.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              {l.sessionId && l.sessionSeconds != null && (
                <p className="notice notice-ok" style={{ margin: '8px 0 0' }} data-testid={`op-session-${i}`}>
                  <Icon name="clock" /> <span>Horímetro digital: {formatHoursMinutes(l.sessionSeconds)} (calculado pelo início, pausas e fim do serviço)</span>
                </p>
              )}
              {meter !== 'nenhum' && !l.sessionId && (
                <div className="row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
                  <div className="field" style={{ flex: 1, margin: 0 }}>
                    <label className="label" htmlFor={`op-ms${i}`}>
                      {meter === 'km' ? 'Km inicial' : 'Horímetro inicial'}
                    </label>
                    <input id={`op-ms${i}`} className="input" inputMode="decimal" value={l.meterStart} onChange={(e) => upd(equips, setEquips, l.key, { meterStart: e.target.value })} />
                  </div>
                  <div className="field" style={{ flex: 1, margin: 0 }}>
                    <label className="label" htmlFor={`op-me${i}`}>
                      {meter === 'km' ? 'Km final' : 'Horímetro final'}
                    </label>
                    <input id={`op-me${i}`} className="input" inputMode="decimal" value={l.meterEnd} onChange={(e) => upd(equips, setEquips, l.key, { meterEnd: e.target.value })} />
                  </div>
                </div>
              )}
              <div className="row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
                {!l.sessionId && (
                <div className="field" style={{ flex: 1, margin: 0 }}>
                  <label className="label" htmlFor={`op-h${i}`}>
                    Horas trabalhadas
                  </label>
                  {auto !== null && meter === 'horimetro' ? (
                    <input id={`op-h${i}`} className="input" disabled value={`${dec(auto, 1)} h (horímetro)`} />
                  ) : (
                    <input id={`op-h${i}`} className="input" inputMode="decimal" value={l.hours} onChange={(e) => upd(equips, setEquips, l.key, { hours: e.target.value })} />
                  )}
                </div>
                )}
                <div className="field" style={{ flex: 1, margin: 0 }}>
                  <label className="label" htmlFor={`op-d${i}`}>
                    Diesel (litros)
                  </label>
                  <input id={`op-d${i}`} className="input" inputMode="decimal" placeholder="0 = sem diesel" value={l.diesel} onChange={(e) => upd(equips, setEquips, l.key, { diesel: e.target.value })} />
                </div>
              </div>
              {l.diesel.trim() && <p className="muted op-line-cost">Diesel ≈ {formatMoney(dieselCostOf(l))} (custo médio do estoque)</p>}
            </div>
          )
        })}
        <button
          type="button"
          className="btn btn-outline btn-block"
          disabled={equipments.length === 0}
          onClick={() => setEquips([...equips, { key: newId(), equipmentId: '', responsibleId: '', meterStart: '', meterEnd: '', hours: '', diesel: '' }])}
          data-testid="add-equipment"
        >
          <Icon name="plus" /> Adicionar trator ou equipamento
        </button>
      </div>

      <h2 className="section-title">Diaristas (opcional)</h2>
      <div className="card stack" data-testid="op-workers-form">
        {workers.map((l, i) => {
          const d = l.workerId ? dayOf(l.workerId) : undefined
          const linked = d && (d.kind === 'integral' || d.kind === 'meia')
          return (
            <div key={l.key} className="op-line">
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <select className="input" style={{ flex: 2 }} aria-label={`Diarista ${i + 1}`} value={l.workerId} onChange={(e) => setWorkers(workers.map((x) => (x.key === l.key ? { ...x, workerId: e.target.value } : x)))}>
                  <option value="">Escolha o trabalhador</option>
                  {(diaristas?.workers ?? [])
                    .filter((w) => w.active || w.id === l.workerId)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
                <button type="button" className="btn btn-outline btn-icon" aria-label={`Remover diarista ${i + 1}`} onClick={() => setWorkers(workers.filter((x) => x.key !== l.key))}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
              {!linked && (
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  {(['integral', 'meia'] as const).map((k) => (
                    <button type="button" key={k} className={`chip${l.kind === k ? ' active' : ''}`} onClick={() => setWorkers(workers.map((x) => (x.key === l.key ? { ...x, kind: k } : x)))}>
                      {k === 'integral' ? 'Diária integral' : 'Meia diária'}
                    </button>
                  ))}
                </div>
              )}
              {l.workerId && (
                <p className="muted op-line-cost" data-testid={`op-worker-${i}`}>
                  {linked
                    ? `Já marcado no calendário (${d!.kind === 'meia' ? 'meia diária' : 'diária integral'}): vincula esta diária, sem duplicar · ${formatMoney(d!.valueCents)}`
                    : d
                      ? `No calendário consta "${d.kind}" neste dia: corrija o calendário antes`
                      : `Será marcado no calendário · ${formatMoney(laborOf(l))}`}
                </p>
              )}
            </div>
          )
        })}
        <button type="button" className="btn btn-outline btn-block" disabled={!diaristas?.workers.length} onClick={() => setWorkers([...workers, { key: newId(), workerId: '', kind: 'integral' }])} data-testid="add-worker">
          <Icon name="plus" /> Adicionar diarista
        </button>
      </div>

      <h2 className="section-title">Outros custos (opcional)</h2>
      <div className="card stack" data-testid="op-costs">
        {costs.map((c, i) => (
          <div key={c.key} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 2, margin: 0 }}>
              <label className="label" htmlFor={`op-cd${i}`}>
                Descrição
              </label>
              <input id={`op-cd${i}`} className="input" maxLength={80} placeholder="Ex.: diária do tratorista" value={c.description} onChange={(e) => upd(costs, setCosts, c.key, { description: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label className="label" htmlFor={`op-cv${i}`}>
                Valor
              </label>
              <input id={`op-cv${i}`} className="input" inputMode="decimal" placeholder="R$" value={c.value} onChange={(e) => upd(costs, setCosts, c.key, { value: e.target.value })} />
            </div>
            <button type="button" className="btn btn-outline btn-icon" aria-label={`Remover custo ${i + 1}`} onClick={() => setCosts(costs.filter((x) => x.key !== c.key))}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-block" onClick={() => setCosts([...costs, { key: newId(), description: '', value: '' }])} data-testid="add-cost">
          <Icon name="plus" /> Mão de obra ou outro custo
        </button>
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="op-notes">
            Observações
          </label>
          <textarea id="op-notes" className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="card" data-testid="op-summary">
        <div className="status-label" style={{ marginBottom: 6 }}>
          Custo da operação (estimado)
        </div>
        <dl className="kv">
          {herb > 0 && (
            <>
              <dt>{type === 'herbicida' ? 'Herbicidas' : 'Produtos'}</dt>
              <dd>{formatMoney(herb)}</dd>
            </>
          )}
          {seeds > 0 && (
            <>
              <dt>Sementes{areaC > 0 && seedKg > 0 ? ` (${(seedKg / 1000 / (areaC / 100)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg/ha)` : ''}</dt>
              <dd>{formatMoney(seeds)}</dd>
            </>
          )}
          {diesel > 0 && (
            <>
              <dt>Diesel</dt>
              <dd>{formatMoney(diesel)}</dd>
            </>
          )}
          {labor > 0 && (
            <>
              <dt>Mão de obra (diaristas)</dt>
              <dd>{formatMoney(labor)}</dd>
            </>
          )}
          {other > 0 && (
            <>
              <dt>Outros custos</dt>
              <dd>{formatMoney(other)}</dd>
            </>
          )}
          <dt>
            <strong>Total</strong>
          </dt>
          <dd data-testid="op-total">{formatMoney(total)}</dd>
          <dt>Por hectare trabalhado</dt>
          <dd data-testid="op-per-ha">{areaC > 0 ? formatMoney(Math.round((total * 100) / areaC)) : '—'}</dd>
        </dl>
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
          O custo final é calculado ao salvar, pelo custo médio de cada estoque na data, e fica guardado na operação.
        </p>
      </div>

      {fix && (
        <div className="card stack">
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="op-fixreason">
              Motivo da correção
            </label>
            <input id="op-fixreason" className="input" maxLength={200} value={fixReason} onChange={(e) => setFixReason(e.target.value)} />
          </div>
          {farm.pinHash && (
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="op-pin">
                PIN da fazenda (autorização)
              </label>
              <input id="op-pin" className="input" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      {negative ? (
        <NegativeAuthorization message={negative} onCancel={() => setNegative(null)} onAuthorize={(reason) => void save(reason)} />
      ) : (
        <button type="submit" className="btn btn-primary btn-block" disabled={saving || (!pastureId && !PASTURE_OPTIONAL.includes(type))} data-testid="save-operation">
          <Icon name="check" /> {fix ? 'Salvar correção' : 'Concluir operação'}
        </button>
      )}
    </form>
  )
}

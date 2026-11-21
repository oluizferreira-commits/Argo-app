import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { newId } from '../../core/ids'
import { formatMoney, parseMoney } from '../../core/money'
import { db } from '../../db/database'
import type { Equipment, FuelMovement } from '../../db/types'
import { Icon } from '../../components/Icon'
import { NegativeAuthorization } from '../../components/NegativeAuthorization'
import { useFarm } from '../fazendas/FarmContext'
import { formatDay, todayLocal } from '../rebanho/herd'
import { useResponsibles } from '../responsaveis/useResponsibles'
import {
  formatLiters,
  formatMeter,
  FuelError,
  fuelLedger,
  FuelNegativeError,
  lastMeterReading,
  parseLiters,
  parseMeter,
  pricePerLiter,
  recordFuelMovement,
  reverseFuelMovement,
  type FuelMovementInput,
} from './fuel'
import { useEquipments, useFuelMovements } from './useFuel'

type FormType = FuelMovementInput['type']
const TYPE_LABEL: Record<FormType, string> = { compra: 'Compra', consumo: 'Abastecimento', ajuste: 'Ajuste' }
const perLiter = (cents: number) => `${formatMoney(cents)}/L`

export function DieselPage() {
  const movements = useFuelMovements()
  const equipments = useEquipments()
  const responsibles = useResponsibles()
  // ?novo=compra|consumo: atalho do Painel abre o formulário direto
  const [params] = useSearchParams()
  const novo = params.get('novo')
  const [form, setForm] = useState<FormType | null>(novo === 'compra' || novo === 'consumo' ? novo : null)
  const [msg, setMsg] = useState<string | null>(null)
  const ledger = useMemo(() => fuelLedger(movements ?? []), [movements])
  if (!movements || !equipments || !responsibles) return null
  const eqName = new Map(equipments.map((e) => [e.id, e]))
  const respName = new Map(responsibles.map((r) => [r.id, r.name]))
  const costOf = new Map(ledger.lines.map((l) => [l.movement.id, l.costCents]))
  const history = [...movements].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const activeEquip = equipments.filter((e) => e.active)

  async function reverse(m: FuelMovement) {
    const reason = window.prompt(`Estornar ${TYPE_LABEL[m.type].toLowerCase()} de ${formatLiters(Math.abs(m.centiliters))}?\n\nInforme o motivo:`)
    if (reason === null) return
    try {
      await reverseFuelMovement(db, m.id, reason)
      setMsg(null)
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>Diesel em estoque</p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 36 }} data-testid="fuel-stock">
          {formatLiters(ledger.balanceCl)}
        </div>
        <p data-testid="fuel-avg">
          {ledger.avgCents ? `Custo médio ${perLiter(ledger.avgCents)} · em estoque ${formatMoney(ledger.valueCents)}` : 'Lance a primeira compra para calcular o custo médio.'}
        </p>
      </section>

      {ledger.balanceCl < 0 && (
        <div className="notice notice-warn">
          <Icon name="alert" />
          <div>Estoque negativo (abastecimento lançado com autorização). Lance a compra que falta para acertar.</div>
        </div>
      )}
      {msg && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{msg}</div>
        </div>
      )}

      {form && !(form === 'consumo' && activeEquip.length === 0) ? (
        <FuelForm key={form} type={form} equipments={activeEquip} movements={movements} onClose={() => setForm(null)} />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {activeEquip.length === 0 ? (
            <Link to="/diesel/equipamentos" className="notice notice-warn" style={{ textDecoration: 'none' }}>
              <Icon name="alert" />
              <div>
                <strong>Cadastre os equipamentos</strong> (trator, caminhonete, roçadeira…) para lançar os abastecimentos.
              </div>
            </Link>
          ) : (
            <button className="btn btn-primary btn-block" onClick={() => setForm('consumo')}>
              <Icon name="fuel" /> Abastecimento
            </button>
          )}
          <div className="row">
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setForm('compra')}>
              <Icon name="plus" /> Compra
            </button>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setForm('ajuste')}>
              <Icon name="edit" /> Ajuste
            </button>
          </div>
        </div>
      )}

      <div className="card module-list" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <Link to="/relatorios?r=diesel" data-testid="fuel-reports">
          <div className="status-icon">
            <Icon name="chart" />
          </div>
          <div className="status-body">
            <div className="status-label">Relatórios do diesel</div>
            <div className="status-detail">Semana, mês, equipamento, responsável, L/h · PDF</div>
          </div>
          <Icon name="chevronRight" size={20} className="muted" />
        </Link>
        <Link to="/diesel/equipamentos">
          <div className="status-icon">
            <Icon name="gear" />
          </div>
          <div className="status-body">
            <div className="status-label">Equipamentos</div>
            <div className="status-detail">{activeEquip.length} ativo(s)</div>
          </div>
          <Icon name="chevronRight" size={20} className="muted" />
        </Link>
        <Link to="/responsaveis">
          <div className="status-icon">
            <Icon name="user" />
          </div>
          <div className="status-body">
            <div className="status-label">Responsáveis</div>
            <div className="status-detail">{responsibles.filter((r) => r.active).length} ativo(s)</div>
          </div>
          <Icon name="chevronRight" size={20} className="muted" />
        </Link>
      </div>

      <h2 className="section-title">Entradas e saídas</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="fuel-history">
        {history.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0' }}>
            Nenhum lançamento ainda.
          </p>
        ) : (
          history.map((m) => {
            const eq = m.equipmentId ? eqName.get(m.equipmentId) : undefined
            const cost = costOf.get(m.id)
            return (
              <div className={`task${m.status === 'estornado' ? ' reversed' : ''}`} key={m.id}>
                <div className="status-body">
                  <div className="status-label">
                    <span className={m.centiliters > 0 ? 'delta-plus' : 'delta-minus'}>
                      {m.centiliters > 0 ? '+' : '−'}
                      {formatLiters(Math.abs(m.centiliters))}
                    </span>{' '}
                    · {m.type === 'consumo' ? (eq?.name ?? 'Equipamento') : TYPE_LABEL[m.type]}
                    {m.status === 'estornado' && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Estornado</span>}
                    {m.authorizedNegative && <span className="badge badge-gold" style={{ marginLeft: 8 }}>Autorizado</span>}
                  </div>
                  <div className="status-detail">
                    {formatDay(m.date)}
                    {m.type === 'compra' && m.totalCents !== null && ` · ${m.station} · ${formatMoney(m.totalCents)} (${perLiter(pricePerLiter(m.totalCents, m.centiliters))})`}
                    {m.type !== 'compra' && cost !== undefined && cost > 0 && ` · custo ${formatMoney(cost)}`}
                    {m.responsibleId && ` · ${respName.get(m.responsibleId) ?? ''}`}
                    {eq && m.meterReading !== null && ` · ${formatMeter(m.meterReading, eq.meter)}`}
                    {m.notes && ` · ${m.notes}`}
                    {m.status === 'estornado' && m.reverseReason && ` · estorno: ${m.reverseReason}`}
                  </div>
                </div>
                {m.operationId && (
                  <Link to={`/manejo/${m.operationId}`} className="btn btn-outline btn-icon" aria-label="Abrir operação de campo">
                    <Icon name="pasture" size={20} />
                  </Link>
                )}
                {m.status === 'ativo' && !m.operationId && (
                  <button className="btn btn-danger btn-icon" aria-label={`Estornar ${TYPE_LABEL[m.type]} de ${formatLiters(Math.abs(m.centiliters))}`} onClick={() => reverse(m)}>
                    <Icon name="undo" size={20} />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}

function FuelForm({ type, equipments, movements, onClose }: { type: FormType; equipments: Equipment[]; movements: FuelMovement[]; onClose: () => void }) {
  const { farm } = useFarm()
  const responsibles = (useResponsibles() ?? []).filter((r) => r.active)
  const [key] = useState(newId)
  const [date, setDate] = useState(todayLocal)
  const [liters, setLiters] = useState('')
  const [total, setTotal] = useState('')
  const [station, setStation] = useState('')
  const [equipmentId, setEquipmentId] = useState(equipments.length === 1 ? equipments[0].id : '')
  // abastecimento: o responsável vem do equipamento (pode trocar); compra: escolhido à parte
  const [responsibleId, setResponsibleId] = useState(type === 'consumo' && equipments.length === 1 ? (equipments[0].responsibleId ?? '') : '')
  const [meter, setMeter] = useState('')
  const [direction, setDirection] = useState<'entrada' | 'saida' | ''>('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [negative, setNegative] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const eq = equipments.find((e) => e.id === equipmentId)
  const last = eq ? lastMeterReading(movements, eq.id) : undefined

  const preview = (() => {
    try {
      const cl = parseLiters(liters)
      const cents = parseMoney(total)
      return type === 'compra' && cents ? `Preço por litro: ${perLiter(pricePerLiter(cents, cl))}` : null
    } catch {
      return null
    }
  })()

  function chooseEquipment(id: string) {
    setEquipmentId(id)
    const e = equipments.find((x) => x.id === id)
    if (e?.responsibleId && responsibles.some((r) => r.id === e.responsibleId)) setResponsibleId(e.responsibleId)
  }

  async function save(authorizeReason?: string) {
    setError(null)
    setSaving(true)
    try {
      const input: FuelMovementInput = {
        type,
        date,
        centiliters: parseLiters(liters),
        totalCents: type === 'compra' ? parseMoney(total) : null,
        station,
        equipmentId: type === 'consumo' ? equipmentId || null : null,
        responsibleId: responsibleId || null,
        meterReading: type === 'consumo' && eq && eq.meter !== 'nenhum' ? parseMeter(meter) : null,
        direction: type === 'ajuste' ? direction || undefined : undefined,
        notes,
      }
      await recordFuelMovement(db, farm.id, input, key, authorizeReason ? { reason: authorizeReason } : undefined)
      onClose()
    } catch (err) {
      setSaving(false)
      if (err instanceof FuelNegativeError) setNegative(err.message)
      else setError(err instanceof FuelError ? err.message : (err as Error).message)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void save()
  }

  return (
    <form onSubmit={submit} className="card stack" data-testid="fuel-form">
      <div className="status-label">{type === 'consumo' ? 'Abastecimento de equipamento' : type === 'compra' ? 'Compra de diesel' : 'Ajuste do estoque de diesel'}</div>
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
          <label className="label" htmlFor="fu-eq">
            Equipamento
          </label>
          <select id="fu-eq" className="input" value={equipmentId} onChange={(e) => chooseEquipment(e.target.value)}>
            <option value="">Escolha o equipamento</option>
            {equipments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.identification ? ` (${e.identification})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="fu-liters">
          Litros
        </label>
        <input id="fu-liters" className="input" inputMode="decimal" placeholder="Ex.: 80" value={liters} onChange={(e) => setLiters(e.target.value)} />
      </div>
      {type === 'compra' && (
        <>
          <div className="field">
            <label className="label" htmlFor="fu-total">
              Valor total pago
            </label>
            <input id="fu-total" className="input" inputMode="decimal" placeholder="R$ 0,00" value={total} onChange={(e) => setTotal(e.target.value)} />
            {preview && (
              <p className="muted" style={{ margin: '6px 0 0' }} data-testid="fuel-price-preview">
                {preview}
              </p>
            )}
          </div>
          <div className="field">
            <label className="label" htmlFor="fu-station">
              Posto
            </label>
            <input id="fu-station" className="input" maxLength={80} value={station} onChange={(e) => setStation(e.target.value)} />
          </div>
        </>
      )}
      {type === 'consumo' && eq && eq.meter !== 'nenhum' && (
        <div className="field">
          <label className="label" htmlFor="fu-meter">
            {eq.meter === 'horimetro' ? 'Horímetro (horas)' : 'Hodômetro (km)'}
          </label>
          <input id="fu-meter" className="input" inputMode="decimal" placeholder={last ? `Última: ${formatMeter(last.meterReading, eq.meter)}` : 'Opcional'} value={meter} onChange={(e) => setMeter(e.target.value)} />
        </div>
      )}
      {type !== 'ajuste' && (
        <div className="field">
          <label className="label" htmlFor="fu-resp">
            Responsável
          </label>
          <select id="fu-resp" className="input" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
            <option value="">{responsibles.length ? 'Escolha (opcional)' : 'Nenhum cadastrado'}</option>
            {responsibles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="fu-date">
          Data
        </label>
        <input id="fu-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="fu-notes">
          {type === 'ajuste' ? 'Motivo do ajuste (obrigatório)' : 'Observação'}
        </label>
        <input id="fu-notes" className="input" maxLength={200} placeholder={type === 'ajuste' ? 'Ex.: medição do tanque' : ''} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving || !liters.trim()}>
            <Icon name="check" /> Registrar
          </button>
        </div>
      )}
    </form>
  )
}

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { formatMoney, parseDecimal } from '../../core/money'
import { db } from '../../db/database'
import type { Equipment, MaintenancePlan } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { formatQty } from '../insumos/supplies'
import { formatDay } from '../rebanho/herd'
import { formatMeterH } from './machines'
import { CHECK_LABEL, createPlan, MAINTENANCE_SUGGESTIONS, planStatus, setPlanActive, updatePlan, type PlanStatus } from './maintenance'
import type { MaquinasData } from './useMaquinas'

const STATE: Record<PlanStatus['state'], [string, string]> = { ok: ['badge-ok', 'Em dia'], proximo: ['badge-gold', 'Próxima'], vencido: ['badge-warn', 'Vencida'], 'sem-base': ['badge-neutral', 'Sem referência'] }

function nextText(st: PlanStatus): string {
  const parts: string[] = []
  if (st.nextMeter !== null) parts.push(`${formatMeterH(st.nextMeter)}${st.hoursLeft !== null ? ` (${st.hoursLeft >= 0 ? `faltam ${formatMeterH(st.hoursLeft)}` : `passou ${formatMeterH(-st.hoursLeft)}`})` : ''}`)
  if (st.nextDate) parts.push(`${formatDay(st.nextDate)}${st.daysLeft !== null ? ` (${st.daysLeft >= 0 ? `em ${st.daysLeft} dia(s)` : `há ${-st.daysLeft} dia(s)`})` : ''}`)
  return parts.length ? `Próxima: ${parts.join(' ou ')}` : 'Informe a última vez feita para calcular a próxima'
}

/** Manutenção na página da máquina: alertas, planos, solicitações e histórico. */
export function MaintenanceSection({ eq, data }: { eq: Equipment; data: MaquinasData }) {
  const [planForm, setPlanForm] = useState<MaintenancePlan | 'novo' | null>(null)
  const meter = data.meterOf(eq)
  const plans = data.plans.filter((p) => p.equipmentId === eq.id && p.deletedAt === null).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'))
  const records = data.records.filter((r) => r.equipmentId === eq.id && r.deletedAt === null)
  const requests = records.filter((r) => r.status === 'solicitada')
  const history = records.filter((r) => r.status !== 'solicitada').sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.createdAt.localeCompare(a.createdAt))
  const alerts = plans.filter((p) => p.active).map((p) => ({ p, st: planStatus(p, data.records, meter) })).filter((x) => x.st.state === 'vencido' || x.st.state === 'proximo')
  const totalCost = history.filter((r) => r.status === 'concluida').reduce((a, r) => a + r.stockCents + r.directCents, 0)

  return (
    <>
      {(alerts.length > 0 || requests.length > 0) && (
        <>
          <h2 className="section-title">Alertas pendentes</h2>
          <div className="card pending-list" data-testid="machine-alerts">
            {alerts.map(({ p, st }) => (
              <Link key={p.id} to={`/maquinas/${eq.id}/manutencao?plano=${p.id}`} className="pending-row">
                <span className={`prio prio-${st.state === 'vencido' ? 1 : 2}`}>
                  <Icon name="gear" size={18} />
                </span>
                <div className="pending-body">
                  <div className="pending-pasture">
                    {st.state === 'vencido' ? 'Vencida' : 'Próxima'} · {p.name}
                  </div>
                  <div className="pending-tasks">{nextText(st)}</div>
                </div>
              </Link>
            ))}
            {requests.map((r) => (
              <Link key={r.id} to={`/maquinas/${eq.id}/manutencao?solicitacao=${r.id}`} className="pending-row" data-testid="request-row">
                <span className="prio prio-1">
                  <Icon name="alert" size={18} />
                </span>
                <div className="pending-body">
                  <div className="pending-pasture">Solicitada · {r.kind}</div>
                  <div className="pending-tasks">{r.problem}</div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">Manutenção programada</h2>
      <div className="card pasture-list" data-testid="plans">
        {plans.length === 0 && (
          <p className="muted" style={{ margin: '10px 0' }}>
            Nenhuma manutenção programada. Cadastre a troca de óleo, os filtros, a lubrificação…
          </p>
        )}
        {plans.map((p) => {
          const st = planStatus(p, data.records, meter)
          const [cls, label] = STATE[st.state]
          return (
            <div key={p.id} className={`vacc-item${p.active ? '' : ' reversed'}`} data-testid="plan-item">
              <span className="vacc-head">
                <span className="pasture-name">{p.name}</span>
                <span className={`badge ${p.active ? cls : 'badge-neutral'}`}>{p.active ? label : 'Desativado'}</span>
              </span>
              <span className="pasture-area">
                A cada {[p.intervalHours ? formatMeterH(p.intervalHours) : '', p.intervalDays ? `${p.intervalDays} dia(s)` : ''].filter(Boolean).join(' ou ')}
                {st.lastDate || st.lastMeter !== null ? ` · última: ${[st.lastMeter !== null ? formatMeterH(st.lastMeter) : '', st.lastDate ? formatDay(st.lastDate) : ''].filter(Boolean).join(', ')}` : ''}
              </span>
              <span className="vacc-next" data-testid="plan-next">
                {nextText(st)}
              </span>
              <span className="row" style={{ gap: 8, marginTop: 6 }}>
                <Link to={`/maquinas/${eq.id}/manutencao?plano=${p.id}`} className="btn btn-primary" style={{ flex: 1, minHeight: 44 }} data-testid="do-plan">
                  <Icon name="check" size={18} /> Registrar
                </Link>
                <button className="btn btn-outline btn-icon" aria-label={`Editar ${p.name}`} onClick={() => setPlanForm(p)}>
                  <Icon name="edit" size={18} />
                </button>
              </span>
            </div>
          )
        })}
      </div>
      {planForm ? (
        <PlanForm eq={eq} current={planForm === 'novo' ? null : planForm} meter={meter} onClose={() => setPlanForm(null)} />
      ) : (
        <div className="row">
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setPlanForm('novo')} data-testid="new-plan">
            <Icon name="plus" /> Programar manutenção
          </button>
          <Link to={`/maquinas/${eq.id}/manutencao`} className="btn btn-outline" style={{ flex: 1 }} data-testid="new-maintenance">
            <Icon name="gear" /> Manutenção avulsa
          </Link>
        </div>
      )}

      <h2 className="section-title">Histórico de manutenções</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="maintenance-history">
        {history.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0', margin: 0 }}>
            Nenhuma manutenção registrada.
          </p>
        ) : (
          history.map((r) => (
            <div key={r.id} className={`task${r.status === 'cancelada' ? ' reversed' : ''}`}>
              <div className="status-body">
                <div className="status-label">
                  {r.kind}
                  {r.status === 'cancelada' && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Cancelada</span>}
                </div>
                <div className="status-detail">
                  {[
                    r.date ? formatDay(r.date) : '',
                    r.meter !== null ? formatMeterH(r.meter) : '',
                    r.responsibleId ? data.personById.get(r.responsibleId) : '',
                    r.parts.map((x) => (x.supplyId && x.qty && x.unit ? `${x.description} ${formatQty(x.qty, x.unit)}` : x.description)).join(' + '),
                    r.stockCents + r.directCents ? formatMoney(r.stockCents + r.directCents) : '',
                    r.status === 'cancelada' ? `cancelada: ${r.cancelReason}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {totalCost > 0 && (
        <p className="muted" style={{ margin: '0 4px' }} data-testid="maintenance-total">
          Custo total de manutenção: {formatMoney(totalCost)}
        </p>
      )}
    </>
  )
}

function PlanForm({ eq, current, meter, onClose }: { eq: Equipment; current: MaintenancePlan | null; meter: number | null; onClose: () => void }) {
  const { farm } = useFarm()
  const h2 = (v: number | null | undefined) => (v == null ? '' : (v / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }).replace(/\./g, ''))
  const [name, setName] = useState(current?.name ?? '')
  const [hours, setHours] = useState(h2(current?.intervalHours))
  const [days, setDays] = useState(current?.intervalDays ? String(current.intervalDays) : '')
  const [warnH, setWarnH] = useState(h2(current?.warnHours))
  const [warnD, setWarnD] = useState(current?.warnDays != null ? String(current.warnDays) : '')
  const [lastMeter, setLastMeter] = useState(current ? h2(current.baselineMeter) : h2(meter))
  const [lastDate, setLastDate] = useState(current?.baselineDate ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const num = (t: string, places: number) => (t.trim() ? (parseDecimal(t, places) ?? NaN) : null)
      const input = {
        equipmentId: eq.id,
        name,
        intervalHours: num(hours, 2),
        intervalDays: days.trim() ? Number(days) : null,
        warnHours: num(warnH, 2),
        warnDays: warnD.trim() ? Number(warnD) : null,
        baselineMeter: num(lastMeter, 2),
        baselineDate: lastDate || null,
        notes: '',
      }
      if (current) await updatePlan(db, current.id, input)
      else await createPlan(db, farm.id, input)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack" data-testid="plan-form">
      <div className="status-label">{current ? 'Editar manutenção programada' : 'Programar manutenção'}</div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="pl-name">
          Tipo de manutenção
        </label>
        <input id="pl-name" className="input" list="pl-suggest" maxLength={60} placeholder="Ex.: Troca de óleo do motor" value={name} onChange={(e) => setName(e.target.value)} />
        <datalist id="pl-suggest">
          {MAINTENANCE_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Intervalo por horas, por dias ou os dois (vale o que vencer primeiro).
      </p>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="pl-hours">
            A cada (horas)
          </label>
          <input id="pl-hours" className="input" inputMode="decimal" placeholder="Ex.: 250" value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="pl-days">
            A cada (dias)
          </label>
          <input id="pl-days" className="input" inputMode="numeric" placeholder="Ex.: 15" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="pl-warnh">
            Avisar antes (horas)
          </label>
          <input id="pl-warnh" className="input" inputMode="decimal" placeholder="Ex.: 10" value={warnH} onChange={(e) => setWarnH(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="pl-warnd">
            Avisar antes (dias)
          </label>
          <input id="pl-warnd" className="input" inputMode="numeric" placeholder="Ex.: 3" value={warnD} onChange={(e) => setWarnD(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      <div className="label" style={{ margin: 0 }}>
        Última vez feita (antes de usar o ARGO)
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <input className="input" inputMode="decimal" aria-label="Horímetro da última vez" placeholder="Horímetro (ex.: 1000)" value={lastMeter} onChange={(e) => setLastMeter(e.target.value)} />
        <input className="input" type="date" aria-label="Data da última vez" value={lastDate} onChange={(e) => setLastDate(e.target.value)} />
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
      {current && (
        <button type="button" className="btn btn-outline btn-block" onClick={() => setPlanActive(db, current.id, !current.active).then(onClose)}>
          {current.active ? 'Desativar esta manutenção' : 'Reativar'}
        </button>
      )}
    </form>
  )
}

/** Histórico de checklists da máquina. */
export function ChecklistHistory({ eq, data }: { eq: Equipment; data: MaquinasData }) {
  const [open, setOpen] = useState<string | null>(null)
  const list = data.checklists.filter((c) => c.equipmentId === eq.id && c.deletedAt === null).sort((a, b) => b.at.localeCompare(a.at))
  return (
    <>
      <h2 className="section-title">Inspeção diária</h2>
      <Link to={`/maquinas/${eq.id}/checklist`} className="btn btn-gold btn-block" data-testid="do-checklist">
        <Icon name="clipboard" /> Fazer o checklist de hoje
      </Link>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="checklist-history">
        {list.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0', margin: 0 }}>
            Nenhuma inspeção registrada.
          </p>
        ) : (
          list.slice(0, 20).map((c) => (
            <div key={c.id} className="task" style={{ display: 'block' }}>
              <button type="button" className="status-link" onClick={() => setOpen(open === c.id ? null : c.id)}>
                <div className="status-label">
                  {new Date(c.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {c.hasProblem ? <span className="badge badge-warn" style={{ marginLeft: 8 }}>Problema</span> : <span className="badge badge-ok" style={{ marginLeft: 8 }}>OK</span>}
                </div>
                <div className="status-detail">
                  {c.responsibleId ? data.personById.get(c.responsibleId) : 'Sem responsável'}
                  {c.photos.length ? ` · ${c.photos.length} foto(s)` : ''}
                  {c.requestId ? ' · manutenção solicitada' : ''}
                </div>
              </button>
              {open === c.id && (
                <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                  {c.items.map((i) => (
                    <div key={i.label} className="cat-line">
                      <span>
                        {i.label}
                        {i.note ? ` — ${i.note}` : ''}
                      </span>
                      <span className={i.status === 'problema' ? 'delta-minus' : ''}>{CHECK_LABEL[i.status]}</span>
                    </div>
                  ))}
                  {c.photos.length > 0 && (
                    <div className="photo-grid">
                      {c.photos.map((p, k) => (
                        <img key={k} src={p} alt={`Foto ${k + 1} da inspeção`} />
                      ))}
                    </div>
                  )}
                  {c.notes && <p className="muted" style={{ margin: 0 }}>{c.notes}</p>}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  )
}

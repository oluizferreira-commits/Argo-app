import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { Vaccination, VaccinationApplication } from '../../db/types'
import { Icon } from '../../components/Icon'
import { formatDay, todayLocal } from '../rebanho/herd'
import { useResponsibles } from '../responsaveis/useResponsibles'
import { CoverageBar } from './CoverageBar'
import { useVaccinations } from './useVaccinations'
import { addApplication, lotLabel, reverseApplication, STATUS_LABEL, updateVaccination, VaccinationError, type Coverage } from './vaccination'

export function VacinacaoDetailPage() {
  const { id } = useParams()
  const data = useVaccinations()
  const [form, setForm] = useState<'aplicar' | 'editar' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  if (!data) return null
  const row = data.rows.find((r) => r.v.id === id)
  if (!row) return <p className="muted">Vacinação não encontrada.</p>
  const { v, cov, pasture, apps } = row
  const person = (rid: string | null) => (rid ? (data.responsibles.get(rid)?.name ?? '—') : '—')
  const nextDue = v.nextDate && !v.followUpId ? v.nextDate : null

  async function reverse(a: VaccinationApplication) {
    const reason = window.prompt(`Estornar a aplicação de ${a.quantity} animal(is) em ${formatDay(a.date)}?\n\nOs animais voltam a ficar pendentes. Informe o motivo:`)
    if (reason === null) return
    try {
      await reverseApplication(db, a.id, reason)
      setMsg(null)
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>
          {v.vaccine}
          {v.product ? ` · ${v.product}` : ''}
        </p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 36 }} data-testid="vacc-percent">
          {cov.percent}%
        </div>
        <p data-testid="vacc-summary">
          {cov.vaccinated} de {cov.planned} vacinados · {cov.pending} pendentes · {STATUS_LABEL[cov.status]}
        </p>
      </section>

      {cov.pending > 0 ? (
        <div className="notice notice-warn" data-testid="vacc-pending">
          <Icon name="alert" />
          <div>
            <strong>{cov.pending} animal(is) ainda sem vacina neste lote.</strong> Eles não contam como vacinados até você registrar a aplicação.
          </div>
        </div>
      ) : (
        <div className="notice notice-ok">
          <Icon name="check" />
          <div>Todos os animais previstos deste lote foram vacinados.</div>
        </div>
      )}
      {msg && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{msg}</div>
        </div>
      )}

      <div className="card stack">
        <CoverageBar cov={cov} />
        <dl className="kv">
          <dt>Pasto / lote</dt>
          <dd>{lotLabel(pasture?.name ?? 'pasto removido', v.lot)}</dd>
          <dt>Responsável</dt>
          <dd>{person(v.responsibleId)}</dd>
          <dt>Próxima vacinação</dt>
          <dd data-testid="vacc-next">{v.followUpId ? 'Já registrada' : v.nextDate ? formatDay(v.nextDate) : 'Não programada'}</dd>
          {v.notes && (
            <>
              <dt>Observações</dt>
              <dd>{v.notes}</dd>
            </>
          )}
        </dl>
      </div>

      {form === 'aplicar' ? (
        <ApplicationForm vaccination={v} cov={cov} onClose={() => setForm(null)} />
      ) : form === 'editar' ? (
        <EditForm vaccination={v} vaccinated={cov.vaccinated} onClose={() => setForm(null)} />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {cov.pending > 0 && (
            <button className="btn btn-primary btn-block" onClick={() => setForm('aplicar')} data-testid="add-application">
              <Icon name="syringe" /> Registrar aplicação ({cov.pending} pendentes)
            </button>
          )}
          {nextDue && (
            <Link to={`/vacinacao/nova?de=${v.id}`} className="btn btn-gold btn-block" data-testid="register-next">
              <Icon name="plus" /> Registrar a próxima vacinação ({formatDay(nextDue)})
            </Link>
          )}
          <button className="btn btn-outline btn-block" onClick={() => setForm('editar')}>
            <Icon name="edit" /> Corrigir dados da vacinação
          </button>
        </div>
      )}

      <h2 className="section-title">Aplicações</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="vacc-history">
        {apps.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0' }}>
            Nenhuma aplicação registrada ainda.
          </p>
        ) : (
          apps.map((a) => (
            <div className={`task${a.status === 'estornado' ? ' reversed' : ''}`} key={a.id}>
              <div className="status-body">
                <div className="status-label">
                  <span className="delta-plus">{a.quantity} vacinado(s)</span>
                  {a.status === 'estornado' && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Estornado</span>}
                </div>
                <div className="status-detail">
                  {formatDay(a.date)}
                  {a.responsibleId && ` · ${person(a.responsibleId)}`}
                  {a.notes && ` · ${a.notes}`}
                  {a.status === 'estornado' && a.reverseReason && ` · estorno: ${a.reverseReason}`}
                </div>
              </div>
              {a.status === 'ativo' && (
                <button className="btn btn-danger btn-icon" aria-label={`Estornar aplicação de ${a.quantity} em ${formatDay(a.date)}`} onClick={() => reverse(a)}>
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

function ApplicationForm({ vaccination, cov, onClose }: { vaccination: Vaccination; cov: Coverage; onClose: () => void }) {
  const responsibles = (useResponsibles() ?? []).filter((r) => r.active)
  const [key] = useState(newId)
  const [date, setDate] = useState(todayLocal)
  const [qty, setQty] = useState(String(cov.pending))
  const [responsibleId, setResponsibleId] = useState(vaccination.responsibleId ?? '')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await addApplication(db, vaccination.id, { date, quantity: Number(qty || 0), responsibleId: responsibleId || null, notes }, key)
      onClose()
    } catch (err) {
      setError(err instanceof VaccinationError ? err.message : (err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack" data-testid="application-form">
      <div className="status-label">Nova aplicação · faltam {cov.pending}</div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="ap-date">
            Data
          </label>
          <input id="ap-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="ap-qty">
            Vacinados
          </label>
          <input id="ap-qty" className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="ap-resp">
          Responsável
        </label>
        <select id="ap-resp" className="input" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
          <option value="">{responsibles.length ? 'Escolha (opcional)' : 'Nenhum cadastrado'}</option>
          {responsibles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="ap-notes">
          Observação
        </label>
        <input id="ap-notes" className="input" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={!qty}>
          <Icon name="check" /> Registrar
        </button>
      </div>
    </form>
  )
}

function EditForm({ vaccination: v, vaccinated, onClose }: { vaccination: Vaccination; vaccinated: number; onClose: () => void }) {
  const responsibles = (useResponsibles() ?? []).filter((r) => r.active || r.id === v.responsibleId)
  const [lot, setLot] = useState(v.lot)
  const [vaccine, setVaccine] = useState(v.vaccine)
  const [product, setProduct] = useState(v.product)
  const [planned, setPlanned] = useState(String(v.plannedQty))
  const [responsibleId, setResponsibleId] = useState(v.responsibleId ?? '')
  const [nextDate, setNextDate] = useState(v.nextDate ?? '')
  const [notes, setNotes] = useState(v.notes)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await updateVaccination(db, v.id, { pastureId: v.pastureId, lot, vaccine, product, plannedQty: Number(planned || 0), responsibleId: responsibleId || null, nextDate: nextDate || null, notes })
      onClose()
    } catch (err) {
      setError(err instanceof VaccinationError ? err.message : (err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack" data-testid="edit-vaccination">
      <div className="status-label">Corrigir dados</div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="ed-planned">
          Quantidade prevista (mínimo {vaccinated}, já vacinados)
        </label>
        <input id="ed-planned" className="input" inputMode="numeric" value={planned} onChange={(e) => setPlanned(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="ed-lot">
          Lote
        </label>
        <input id="ed-lot" className="input" maxLength={60} value={lot} onChange={(e) => setLot(e.target.value)} />
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="ed-vaccine">
            Vacina
          </label>
          <input id="ed-vaccine" className="input" maxLength={60} value={vaccine} onChange={(e) => setVaccine(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label className="label" htmlFor="ed-product">
            Produto
          </label>
          <input id="ed-product" className="input" maxLength={80} value={product} onChange={(e) => setProduct(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="ed-resp">
          Responsável
        </label>
        <select id="ed-resp" className="input" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
          <option value="">Nenhum</option>
          {responsibles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="ed-next">
          Próxima vacinação (opcional — apague para não ter)
        </label>
        <input id="ed-next" type="date" className="input" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="ed-notes">
          Observações
        </label>
        <textarea id="ed-notes" className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
    </form>
  )
}

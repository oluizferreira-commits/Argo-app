import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { formatMoney } from '../../core/money'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { formatLiters } from '../diesel/fuel'
import { useFarm } from '../fazendas/FarmContext'
import { verifyPin } from '../fazendas/farms'
import { formatQty } from '../insumos/supplies'
import { formatHoursMinutes } from '../maquinas/machines'
import { formatDay } from '../rebanho/herd'
import { cancelOperation, costPerHa, formatHa, formatHours, typeLabel } from './operations'
import { useManejo } from './useManejo'

const num = (n: number) => String(n).padStart(4, '0')

export function OperacaoPage() {
  const { id } = useParams()
  const data = useManejo()
  const { farm } = useFarm()
  const [canceling, setCanceling] = useState(false)
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!data) return null
  const op = data.operations.find((o) => o.id === id)
  if (!op) return <p className="muted">Operação não encontrada.</p>
  const pasture = data.pastureById.get(op.pastureId)
  const person = (rid: string | null) => (rid ? (data.personById.get(rid) ?? '—') : '—')
  const replacement = op.replacedById ? data.operations.find((o) => o.id === op.replacedById) : undefined
  const replaced = op.replacesId ? data.operations.find((o) => o.id === op.replacesId) : undefined

  async function cancel() {
    setError(null)
    try {
      if (!reason.trim()) throw new Error('Informe o motivo do cancelamento.')
      if (!(await verifyPin(farm, pin))) throw new Error('PIN da fazenda incorreto.')
      await cancelOperation(db, op!.id, reason)
      setCanceling(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>
          Operação nº {num(op.number)} · {typeLabel(op.type, op.customType)}
        </p>
        <div className="big-number" style={{ marginTop: 6, fontSize: 34 }} data-testid="op-detail-total">
          {formatMoney(op.totalCents)}
        </div>
        <p data-testid="op-detail-perha">
          {formatMoney(costPerHa(op))}/ha · {formatHa(op.workedAreaCentiHa)} trabalhados
        </p>
      </section>

      {op.status === 'cancelada' && (
        <div className="notice notice-warn" data-testid="op-canceled">
          <Icon name="alert" />
          <div>
            <strong>Operação cancelada</strong>
            {op.canceledAt ? ` em ${formatDay(op.canceledAt.slice(0, 10))}` : ''}: {op.cancelReason}. Produtos e diesel voltaram ao estoque.
            {replacement && (
              <>
                {' '}
                <Link className="inline-link" to={`/manejo/${replacement.id}`}>Ver a operação nº {num(replacement.number)} que a corrigiu</Link>.
              </>
            )}
          </div>
        </div>
      )}
      {replaced && (
        <div className="notice notice-ok">
          <Icon name="edit" />
          <div>
            Esta operação corrige a <Link className="inline-link" to={`/manejo/${replaced.id}`}>nº {num(replaced.number)}</Link>.
          </div>
        </div>
      )}

      <div className="card">
        <dl className="kv">
          <dt>Data</dt>
          <dd>{formatDay(op.date)}</dd>
          <dt>{op.pastureId ? 'Pasto' : 'Local'}</dt>
          <dd>
            {op.pastureId ? (
              <Link className="inline-link" to={`/pastos/${op.pastureId}`}>
                {pasture?.name ?? 'pasto removido'}
              </Link>
            ) : (
              op.location
            )}
          </dd>
          <dt>Área trabalhada</dt>
          <dd>
            {formatHa(op.workedAreaCentiHa)}
            {op.pastureAreaCentiHa ? ` de ${formatHa(op.pastureAreaCentiHa)}` : ''}
          </dd>
          <dt>Responsável</dt>
          <dd>{person(op.responsibleId)}</dd>
        </dl>
      </div>

      <h2 className="section-title">Composição do custo</h2>
      <div className="card" data-testid="op-composition">
        <dl className="kv">
          {op.productsCents > 0 && (
            <>
              <dt>{op.type === 'herbicida' ? 'Herbicidas consumidos' : 'Produtos consumidos'}</dt>
              <dd>{formatMoney(op.productsCents)}</dd>
            </>
          )}
          {op.seedsCents > 0 && (
            <>
              <dt>Sementes utilizadas</dt>
              <dd>{formatMoney(op.seedsCents)}</dd>
            </>
          )}
          {op.dieselCents > 0 && (
            <>
              <dt>Diesel utilizado</dt>
              <dd>{formatMoney(op.dieselCents)}</dd>
            </>
          )}
          {(op.laborCents ?? 0) > 0 && (
            <>
              <dt>Mão de obra (diaristas)</dt>
              <dd>{formatMoney(op.laborCents ?? 0)}</dd>
            </>
          )}
          {op.otherCents > 0 && (
            <>
              <dt>Outros custos registrados</dt>
              <dd>{formatMoney(op.otherCents)}</dd>
            </>
          )}
          <dt>
            <strong>Custo total</strong>
          </dt>
          <dd>{formatMoney(op.totalCents)}</dd>
          <dt>Custo por hectare</dt>
          <dd>{formatMoney(costPerHa(op))}</dd>
        </dl>
      </div>

      {op.products.length > 0 && (
        <>
          <h2 className="section-title">{op.type === 'plantio' || op.type === 'replantio' ? 'Sementes' : 'Produtos'}</h2>
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="op-products-list">
            {op.products.map((p) => (
              <div className="task" key={p.movementId}>
                <div className="status-body">
                  <div className="status-label">
                    <Link className="inline-link" to={`/insumos/${p.supplyId}`}>{p.name}</Link> · {formatQty(p.qty, p.unit)}
                  </div>
                  <div className="status-detail">
                    {[p.species && p.cultivar ? `${p.species} ${p.cultivar}` : p.species || p.cultivar, p.lot ? `lote ${p.lot}` : '', p.unit === 'kg' && p.category === 'semente' ? `${(p.qty / 1000 / (op.workedAreaCentiHa / 100)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg/ha` : '', formatMoney(p.costCents)]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {op.equipments.length > 0 && (
        <>
          <h2 className="section-title">Equipamentos</h2>
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="op-equipments-list">
            {op.equipments.map((e) => (
              <div className="task" key={e.equipmentId}>
                <div className="status-body">
                  <div className="status-label">{e.name}</div>
                  <div className="status-detail">
                    {[
                      person(e.responsibleId) !== '—' ? person(e.responsibleId) : '',
                      e.meterStart !== null || e.meterEnd !== null ? `medidor ${e.meterStart !== null ? (e.meterStart / 10).toLocaleString('pt-BR') : '?'} → ${e.meterEnd !== null ? (e.meterEnd / 10).toLocaleString('pt-BR') : '?'}` : '',
                      e.sessionSeconds != null ? `${formatHoursMinutes(e.sessionSeconds)} (horímetro digital)` : e.hoursTenths !== null ? formatHours(e.hoursTenths) : '',
                      e.dieselCl ? `${formatLiters(e.dieselCl)} diesel · ${formatMoney(e.dieselCents)}` : 'sem diesel',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {e.fuelMovementId && (
                  <Link to="/diesel" className="btn btn-outline btn-icon" aria-label="Ver no Diesel">
                    <Icon name="fuel" size={18} />
                  </Link>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {(op.workers ?? []).length > 0 && (
        <>
          <h2 className="section-title">Diaristas</h2>
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="op-workers">
            {(op.workers ?? []).map((w) => (
              <div className="task" key={w.workDayId}>
                <div className="status-body">
                  <div className="status-label">
                    <Link className="inline-link" to={`/diaristas/${w.workerId}`}>
                      {w.name}
                    </Link>
                  </div>
                  <div className="status-detail">
                    {w.kind === 'meia' ? 'Meia diária' : 'Diária integral'} · {formatMoney(w.valueCents)} · do calendário (pagamento no fechamento)
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {op.otherCosts.length > 0 && (
        <>
          <h2 className="section-title">Outros custos</h2>
          <div className="card">
            <dl className="kv">
              {op.otherCosts.map((c, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  <dt>{c.description}</dt>
                  <dd>{formatMoney(c.costCents)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
      {op.notes && (
        <div className="card">
          <p style={{ margin: 0 }}>{op.notes}</p>
        </div>
      )}

      {op.status === 'concluida' &&
        (canceling ? (
          <div className="card stack" data-testid="cancel-form">
            <div className="status-label">Cancelar operação</div>
            <p className="muted" style={{ margin: 0 }}>
              Os produtos e o diesel voltam ao estoque. A operação continua no histórico como cancelada.
            </p>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="cx-reason">
                Motivo
              </label>
              <input id="cx-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {farm.pinHash && (
              <div className="field" style={{ margin: 0 }}>
                <label className="label" htmlFor="cx-pin">
                  PIN da fazenda
                </label>
                <input id="cx-pin" className="input" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              </div>
            )}
            {error && (
              <div className="notice notice-error" role="alert">
                <Icon name="alert" />
                <div>{error}</div>
              </div>
            )}
            <div className="row">
              <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setCanceling(false)}>
                Voltar
              </button>
              <button type="button" className="btn btn-danger" style={{ flex: 1 }} onClick={() => void cancel()} data-testid="confirm-cancel">
                Cancelar operação
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <Link to={`/manejo/nova?corrigir=${op.id}`} className="btn btn-outline" style={{ flex: 1 }} data-testid="fix-operation">
              <Icon name="edit" /> Corrigir
            </Link>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setCanceling(true)} data-testid="cancel-operation">
              <Icon name="undo" /> Cancelar
            </button>
          </div>
        ))}
    </>
  )
}

import { useState } from 'react'
import { Link } from 'react-router'
import { formatDateTime } from '../../core/format'
import { formatMoney } from '../../core/money'
import { db } from '../../db/database'
import { ZebuSilhouette, Topography } from '../../components/Art'
import { Icon } from '../../components/Icon'
import { setTaskDone } from '../pastos/pastures'
import { MONTHS } from '../relatorios/reports'
import { AGENDA_DAYS, AGENDA_GROUPS, PRIORITY_LABEL, type Activity, type AgendaItem, type Indicators, type Pendency } from './dashboard'

const n = (v: number) => v.toLocaleString('pt-BR')

// ------------------------------------------------------------------ indicadores

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0)

/** Anel de proporção (ex.: pastos ocupados). */
function Ring({ value, total }: { value: number; total: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  const f = total > 0 ? value / total : 0
  return (
    <svg className="ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r={r} className="ring-track" />
      <circle cx="32" cy="32" r={r} className="ring-fill" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 32 32)" />
    </svg>
  )
}

function HerdPanel({ ind }: { ind: Indicators }) {
  const total = ind.herdMales + ind.herdFemales + ind.herdUnspecified
  const parts = [
    { key: 'f', label: 'Fêmeas', n: ind.herdFemales },
    { key: 'm', label: 'Machos', n: ind.herdMales },
    { key: 'u', label: 'A especificar', n: ind.herdUnspecified },
  ].filter((p) => p.n > 0)
  return (
    <Link to="/rebanho" className="ind ind-herd" data-testid="kpi-animais">
      <ZebuSilhouette className="ind-herd-art" />
      <span className="ind-label">Rebanho total</span>
      <span className="ind-big">
        {n(ind.animals)}
        <small>{ind.animals === 1 ? 'cabeça' : 'cabeças'}</small>
      </span>
      {total > 0 ? (
        <>
          <span className="sexbar" aria-hidden="true">
            {parts.map((p) => (
              <i key={p.key} className={`sx-${p.key}`} style={{ width: `${pct(p.n, total)}%` }} />
            ))}
          </span>
          <span className="sexlegend">
            {parts.map((p) => (
              <span key={p.key}>
                <i className={`dot sx-${p.key}`} />
                {p.label} <b>{n(p.n)}</b>
              </span>
            ))}
          </span>
          {ind.herdCategories.length > 0 && (
            <span className="herd-cats">
              {ind.herdCategories.slice(0, 4).map((c) => (
                <span key={c.id} className="herd-cat">
                  <b>{n(c.count)}</b> {c.label}
                </span>
              ))}
            </span>
          )}
        </>
      ) : (
        <span className="ind-detail">Nenhum animal lançado ainda. Toque para abrir o Rebanho.</span>
      )}
    </Link>
  )
}

export function IndicatorsSection({ ind, today }: { ind: Indicators; today: string }) {
  const month = MONTHS[Number(today.slice(5, 7)) - 1]
  const expenseParts = [
    ind.fuelExpenseCents && `diesel ${formatMoney(ind.fuelExpenseCents)}`,
    ind.supplyExpenseCents && `insumos ${formatMoney(ind.supplyExpenseCents)}`,
    ind.maintenanceExpenseCents && `manutenção ${formatMoney(ind.maintenanceExpenseCents)}`,
    ind.workerExpenseCents && `diaristas ${formatMoney(ind.workerExpenseCents)}`,
  ].filter(Boolean)
  const flowMax = Math.max(ind.receivedMonthCents, ind.expensesMonthCents)
  const balance = ind.receivedMonthCents - ind.expensesMonthCents
  return (
    <>
      <h2 className="section-title">Visão da fazenda</h2>
      <div className="ind-grid" data-testid="indicators">
        <HerdPanel ind={ind} />

        <Link to="/pastos" className="ind ind-pastos" data-testid="kpi-pastos">
          <Topography className="ind-topo" />
          <span className="ind-label">Pastos</span>
          <span className="ind-ring">
            <Ring value={ind.occupiedPastures} total={ind.pastures} />
            <span className="ind-mid">
              {n(ind.occupiedPastures)} de {n(ind.pastures)}
            </span>
          </span>
          <span className="ind-detail">ocupados / cadastrados</span>
        </Link>

        <Link to="/receber" className="ind ind-receber" data-testid="kpi-receber">
          <span className="ind-label">A receber</span>
          <span className="ind-money ind-gold">{formatMoney(ind.openCents)}</span>
          <span className={`ind-detail${ind.overdueCents ? ' ind-alert' : ''}`}>
            {ind.overdueCents ? `vencido ${formatMoney(ind.overdueCents)}` : 'nada vencido'}
          </span>
        </Link>

        <div className="ind ind-flow">
          <span className="ind-label">Fluxo de {month}</span>
          <Link to="/pagamentos" className="flow-line" data-testid="kpi-receitas">
            <span className="flow-head">
              <span>
                <i className="dot flow-in" /> Receitas de {month}
              </span>
              <b className="flow-value">{formatMoney(ind.receivedMonthCents)}</b>
            </span>
            <span className="flow-bar">
              <i className="flow-in" style={{ width: `${pct(ind.receivedMonthCents, flowMax)}%` }} />
            </span>
            <span className="ind-detail">dinheiro recebido no mês</span>
          </Link>
          <Link to={ind.supplyExpenseCents > ind.fuelExpenseCents ? '/insumos' : '/diesel'} className="flow-line" data-testid="kpi-despesas">
            <span className="flow-head">
              <span>
                <i className="dot flow-out" /> Despesas de {month}
              </span>
              <b className="flow-value">{formatMoney(ind.expensesMonthCents)}</b>
            </span>
            <span className="flow-bar">
              <i className="flow-out" style={{ width: `${pct(ind.expensesMonthCents, flowMax)}%` }} />
            </span>
            <span className="ind-detail">{expenseParts.length ? expenseParts.join(' · ') : 'compras de diesel e insumos'}</span>
          </Link>
          <span className="flow-balance">
            Saldo do mês <b className={balance < 0 ? 'neg' : 'pos'}>{formatMoney(balance)}</b>
          </span>
        </div>

        <Link to="/reserva" className="ind ind-reserva" data-testid="kpi-reserva">
          <span className="ind-vault">
            <Icon name="vault" size={26} />
          </span>
          <span className="ind-reserva-body">
            <span className="ind-label">Reserva (conta separada)</span>
            <span className="ind-money">{formatMoney(ind.reserveCents)}</span>
            <span className={`ind-detail${ind.reservePendingCents ? ' ind-alert' : ''}`}>
              {ind.reservePendingCents ? `falta separar ${formatMoney(ind.reservePendingCents)}` : 'em dia'}
            </span>
          </span>
          <Icon name="chevronRight" size={20} className="muted" />
        </Link>
      </div>
    </>
  )
}

// ------------------------------------------------------------------ pendências

const SHOW_PENDENCIES = 4

export function PendingCenter({ items }: { items: Pendency[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, SHOW_PENDENCIES)
  return (
    <>
      <h2 className="section-title section-title-row" id="pendencias">
        Central de Pendências
        <span className={`badge ${items.length ? 'badge-warn' : 'badge-ok'}`} data-testid="pending-count">
          {items.length}
        </span>
      </h2>
      {items.length === 0 ? (
        <div className="notice notice-ok" data-testid="pending-empty">
          <Icon name="check" />
          <div>Nenhuma pendência. Tudo em dia.</div>
        </div>
      ) : (
        <div className="card pending-list" data-testid="pending-center">
          {shown.map((p) => (
            <Link key={p.id} to={p.to} className={`pending-row pr-${p.priority}`} data-testid={`pend-${p.id}`}>
              <span className={`prio prio-${p.priority}`} title={`Prioridade ${PRIORITY_LABEL[p.priority].toLowerCase()}`}>
                <Icon name={p.icon} size={18} />
              </span>
              <div className="pending-body">
                <div className="pending-pasture">{p.title}</div>
                <div className="pending-tasks">{p.detail}</div>
              </div>
              <span className={`badge ${p.priority === 1 ? 'badge-warn' : p.priority === 2 ? 'badge-gold' : 'badge-neutral'}`}>{PRIORITY_LABEL[p.priority]}</span>
            </Link>
          ))}
          {items.length > SHOW_PENDENCIES && (
            <button className="btn btn-outline btn-block" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>
              {all ? 'Mostrar menos' : `Ver todas (${items.length})`}
            </button>
          )}
        </div>
      )}
    </>
  )
}

// ------------------------------------------------------------------ agenda

const SHOW_AGENDA = 8

function dateLabel(date: string | null, today: string): string {
  if (!date) return 'Sem data'
  if (date === today) return 'Hoje'
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000)
  const dm = date.split('-').reverse().slice(0, 2).join('/')
  if (days === 1) return `Amanhã · ${dm}`
  if (days < 0) return `${dm} · há ${-days} dia${days < -1 ? 's' : ''}`
  return `${dm} · em ${days} dias`
}

const STATUS_BADGE = { atrasada: ['badge-warn', 'Atrasada'], pendente: ['badge-neutral', 'Pendente'], concluida: ['badge-ok', 'Concluída'] } as const

export function AgendaSection({ items, today }: { items: AgendaItem[]; today: string }) {
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const shown = all ? items : items.slice(0, SHOW_AGENDA)

  async function toggle(it: AgendaItem) {
    if (!it.taskId) return
    setBusy(it.id)
    try {
      await setTaskDone(db, it.taskId, it.status !== 'concluida')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <h2 className="section-title">Agenda Operacional</h2>
      {items.length === 0 ? (
        <div className="card" data-testid="agenda-empty">
          <p className="muted" style={{ margin: 0 }}>
            Nada na agenda: nenhuma parcela ou vacinação nos próximos {AGENDA_DAYS} dias e nenhum serviço pendente nos pastos.
          </p>
        </div>
      ) : (
        <div className="card agenda" data-testid="agenda">
          {AGENDA_GROUPS.map((g) => {
            const list = shown.filter((i) => i.group === g.id)
            if (list.length === 0) return null
            return (
              <div key={g.id} className="agenda-group">
                <div className="group-title">{g.title}</div>
                {list.map((it) => {
                  const [cls, label] = STATUS_BADGE[it.status]
                  return (
                    <div key={it.id} className={`agenda-row${it.status === 'concluida' ? ' reversed' : ''}`} data-testid={`ag-${it.id}`}>
                      <Link to={it.to} className="agenda-main">
                        <div className="pending-pasture">{it.title}</div>
                        <div className="pending-tasks">{it.detail}</div>
                        <div className="agenda-meta">
                          <span>{dateLabel(it.date, today)}</span>
                          {it.responsible && <span> · {it.responsible}</span>}
                          <span className={`badge ${cls}`}>{label}</span>
                        </div>
                      </Link>
                      {it.kind === 'vacina' || it.kind === 'manutencao' ? (
                        <Link to={it.to} className="btn btn-outline agenda-action" aria-label={`Abrir ${it.title}`}>
                          <Icon name={it.kind === 'vacina' ? 'syringe' : 'gear'} size={20} />
                        </Link>
                      ) : it.taskId ? (
                        <button
                          className={`btn ${it.status === 'concluida' ? 'btn-outline' : 'btn-primary'} agenda-action`}
                          disabled={busy === it.id}
                          onClick={() => void toggle(it)}
                          aria-label={it.status === 'concluida' ? `Desfazer conclusão de ${it.title}` : `Concluir ${it.title}`}
                        >
                          <Icon name={it.status === 'concluida' ? 'undo' : 'check'} size={20} />
                        </button>
                      ) : (
                        <Link to={it.to} className="btn btn-outline agenda-action" aria-label={`Receber: ${it.title}`}>
                          <Icon name="cash" size={20} />
                        </Link>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
          {items.length > SHOW_AGENDA && (
            <button className="btn btn-outline btn-block" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>
              {all ? 'Mostrar menos' : `Ver toda a agenda (${items.length})`}
            </button>
          )}
        </div>
      )}
    </>
  )
}

// ------------------------------------------------------------------ atividades recentes

export function RecentActivity({ items }: { items: Activity[] }) {
  if (items.length === 0) return null
  return (
    <>
      <h2 className="section-title">Atividades recentes</h2>
      <div className="card pending-list" data-testid="activities">
        {items.map((a) => {
          const body = (
            <>
              <Icon name={a.icon} size={18} className="activity-icon" />
              <div className="pending-body">
                <div className="activity-text">{a.text}</div>
                <div className="pending-tasks">{formatDateTime(a.at)}</div>
              </div>
            </>
          )
          return a.to ? (
            <Link key={a.id} to={a.to} className="pending-row">
              {body}
            </Link>
          ) : (
            <div key={a.id} className="pending-row">
              {body}
            </div>
          )
        })}
      </div>
    </>
  )
}

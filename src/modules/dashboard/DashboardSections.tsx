import { useState } from 'react'
import { Link } from 'react-router'
import { formatDateTime } from '../../core/format'
import { formatMoney } from '../../core/money'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { setTaskDone } from '../pastos/pastures'
import { MONTHS } from '../relatorios/reports'
import { AGENDA_DAYS, AGENDA_GROUPS, PRIORITY_LABEL, type Activity, type AgendaItem, type Indicators, type Pendency } from './dashboard'

const n = (v: number) => v.toLocaleString('pt-BR')

// ------------------------------------------------------------------ indicadores

function Kpi({ to, label, value, detail, testId, tone }: { to: string; label: string; value: string; detail: string; testId: string; tone?: 'warn' }) {
  return (
    <Link to={to} className="kpi" data-testid={testId}>
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value${tone === 'warn' ? ' kpi-warn' : ''}`}>{value}</span>
      <span className="kpi-detail">{detail}</span>
    </Link>
  )
}

export function IndicatorsSection({ ind, today }: { ind: Indicators; today: string }) {
  const month = MONTHS[Number(today.slice(5, 7)) - 1]
  const expenseParts = [ind.fuelExpenseCents && `diesel ${formatMoney(ind.fuelExpenseCents)}`, ind.supplyExpenseCents && `insumos ${formatMoney(ind.supplyExpenseCents)}`].filter(Boolean)
  return (
    <>
      <h2 className="section-title">Indicadores da fazenda</h2>
      <div className="kpi-grid" data-testid="indicators">
        <Kpi to="/rebanho" label="Animais" value={n(ind.animals)} detail="no rebanho hoje" testId="kpi-animais" />
        <Kpi to="/pastos" label="Pastos" value={`${n(ind.occupiedPastures)} de ${n(ind.pastures)}`} detail="ocupados / cadastrados" testId="kpi-pastos" />
        <Kpi
          to="/receber"
          label="A receber"
          value={formatMoney(ind.openCents)}
          detail={ind.overdueCents ? `vencido ${formatMoney(ind.overdueCents)}` : 'nada vencido'}
          tone={ind.overdueCents ? 'warn' : undefined}
          testId="kpi-receber"
        />
        <Kpi to="/pagamentos" label={`Receitas de ${month}`} value={formatMoney(ind.receivedMonthCents)} detail="dinheiro recebido no mês" testId="kpi-receitas" />
        <Kpi
          to={ind.supplyExpenseCents > ind.fuelExpenseCents ? '/insumos' : '/diesel'}
          label={`Despesas de ${month}`}
          value={formatMoney(ind.expensesMonthCents)}
          detail={expenseParts.length ? expenseParts.join(' · ') : 'compras de diesel e insumos'}
          testId="kpi-despesas"
        />
        <Kpi
          to="/reserva"
          label="Reserva (conta separada)"
          value={formatMoney(ind.reserveCents)}
          detail={ind.reservePendingCents ? `falta separar ${formatMoney(ind.reservePendingCents)}` : 'em dia'}
          tone={ind.reservePendingCents ? 'warn' : undefined}
          testId="kpi-reserva"
        />
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
      <h2 className="section-title section-title-row">
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
            <Link key={p.id} to={p.to} className="pending-row" data-testid={`pend-${p.id}`}>
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
                      {it.kind === 'vacina' ? (
                        <Link to={it.to} className="btn btn-outline agenda-action" aria-label={`Abrir ${it.title}`}>
                          <Icon name="syringe" size={20} />
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

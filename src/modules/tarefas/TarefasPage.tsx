import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { PastureTask } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { removeTask, setTaskDone } from '../pastos/pastures'
import { formatDay, todayLocal } from '../rebanho/herd'
import { usePastures } from '../rebanho/useHerd'
import { useResponsibles } from '../responsaveis/useResponsibles'
import { addDaysIso, createTask, editTask, sortTasks, TASK_GROUPS, taskGroup, type TaskInput } from './tasks'

type Filter = 'pendentes' | 'concluidas' | 'todas'
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function TarefasPage() {
  const { farm } = useFarm()
  const tasks = useLiveQuery(async () => (await db.pastureTasks.where('farmId').equals(farm.id).toArray()).filter((t) => t.deletedAt === null), [farm.id])
  const pastures = usePastures()
  const people = useResponsibles()
  const [filter, setFilter] = useState<Filter>('pendentes')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [today] = useState(todayLocal)
  if (!tasks || !pastures || !people) return null
  const pastureName = new Map(pastures.map((p) => [p.id, p.name]))
  const personName = new Map(people.map((r) => [r.id, r.name]))
  const q = fold(query.trim())
  const shown = sortTasks(
    tasks.filter((t) => (filter === 'pendentes' ? !t.done : filter === 'concluidas' ? t.done : true) && (!q || fold(`${t.description} ${t.notes ?? ''} ${pastureName.get(t.pastureId) ?? ''}`).includes(q))),
    today,
  )
  const pending = tasks.filter((t) => !t.done)
  const late = pending.filter((t) => taskGroup(t, today) === 'atrasadas').length

  return (
    <>
      <QuickAdd today={today} />

      <div className="chips chips-wrap" role="group" aria-label="Filtrar tarefas">
        {(
          [
            ['pendentes', `Pendentes (${pending.length})`],
            ['concluidas', `Concluídas (${tasks.length - pending.length})`],
            ['todas', 'Todas'],
          ] as const
        ).map(([k, t]) => (
          <button key={k} type="button" className={`chip${filter === k ? ' active' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {t}
          </button>
        ))}
      </div>
      {tasks.length > 5 && (
        <div className="search-box">
          <Icon name="search" size={20} className="muted" />
          <input className="search-input" type="search" placeholder="Pesquisar tarefa" aria-label="Pesquisar tarefa" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {late > 0 && filter !== 'concluidas' && (
        <div className="notice notice-warn" data-testid="late-tasks">
          <Icon name="alert" />
          <div>
            <strong>{late} tarefa(s) atrasada(s).</strong>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card empty">
          <div className="status-icon">
            <Icon name="clipboard" size={28} />
          </div>
          <p className="muted">{tasks.length === 0 ? 'Nenhuma tarefa anotada. Escreva acima o que precisa ser feito.' : 'Nenhuma tarefa neste filtro.'}</p>
        </div>
      ) : (
        TASK_GROUPS.map((g) => {
          const list = shown.filter((t) => taskGroup(t, today) === g.id)
          if (list.length === 0) return null
          return (
            <section key={g.id} className="stack" style={{ gap: 8 }} data-testid={`group-${g.id}`}>
              <h2 className={`section-title${g.id === 'atrasadas' ? ' title-warn' : ''}`}>
                {g.title} ({list.length})
              </h2>
              <div className="card task-list">
                {list.map((t) =>
                  editing === t.id ? (
                    <TaskForm key={t.id} current={t} today={today} onClose={() => setEditing(null)} />
                  ) : (
                    <div key={t.id} className={`task-row${t.done ? ' is-done' : ''}${t.priority === 'alta' && !t.done ? ' is-high' : ''}`} data-testid="task-row">
                      <button
                        type="button"
                        className={`task-check${t.done ? ' checked' : ''}`}
                        aria-label={t.done ? `Reabrir: ${t.description}` : `Concluir: ${t.description}`}
                        onClick={() => void setTaskDone(db, t.id, !t.done)}
                      >
                        {t.done && <Icon name="check" size={18} />}
                      </button>
                      <button type="button" className="task-main status-link" onClick={() => setEditing(t.id)} aria-label={`Editar: ${t.description}`}>
                        <span className="task-title">{t.description}</span>
                        <span className="task-meta">
                          {t.priority === 'alta' && !t.done && <span className="badge badge-warn">Alta</span>}
                          {t.dueDate && <span className={taskGroup(t, today) === 'atrasadas' ? 'delta-minus' : ''}>{t.dueDate === today ? 'Hoje' : t.dueDate === addDaysIso(today, 1) ? 'Amanhã' : formatDay(t.dueDate)}</span>}
                          {t.pastureId && <span>{pastureName.get(t.pastureId) ?? 'pasto removido'}</span>}
                          {t.responsibleId && <span>{personName.get(t.responsibleId)}</span>}
                          {t.done && t.doneAt && <span>feita em {formatDay(t.doneAt.slice(0, 10))}</span>}
                        </span>
                        {t.notes && <span className="tk-notes">{t.notes}</span>}
                      </button>
                    </div>
                  ),
                )}
              </div>
            </section>
          )
        })
      )}
      <p className="muted" style={{ margin: '0 4px', fontSize: 13 }}>
        Os serviços anotados nos pastos também aparecem aqui. Toque na tarefa para ver os detalhes ou editar.
      </p>
    </>
  )
}

/** Anotar rápido: só o texto; "Mais detalhes" abre prazo, responsável, pasto, prioridade e observações. */
function QuickAdd({ today }: { today: string }) {
  const { farm } = useFarm()
  const [key, setKey] = useState(newId)
  const [text, setText] = useState('')
  const [more, setMore] = useState(false)
  const [fields, setFields] = useState<Omit<TaskInput, 'description'>>({ notes: '', pastureId: '', dueDate: null, responsibleId: null, priority: 'normal' })
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await createTask(db, farm.id, { description: text, ...fields }, key)
      setText('')
      setFields({ notes: '', pastureId: '', dueDate: null, responsibleId: null, priority: 'normal' })
      setMore(false)
      setKey(newId())
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack" data-testid="quick-task">
      <div className="row">
        <input className="input" aria-label="Nova tarefa" placeholder="O que precisa ser feito?" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-icon" style={{ minHeight: 56, width: 56 }} aria-label="Adicionar tarefa" disabled={!text.trim()}>
          <Icon name="plus" />
        </button>
      </div>
      {more ? (
        <TaskFields value={fields} onChange={setFields} today={today} />
      ) : (
        <button type="button" className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(true)} data-testid="more-details">
          + Mais detalhes
        </button>
      )}
      {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
    </form>
  )
}

function TaskFields({ value: f, onChange, today }: { value: Omit<TaskInput, 'description'>; onChange: (v: Omit<TaskInput, 'description'>) => void; today: string }) {
  const pastures = usePastures() ?? []
  const people = (useResponsibles() ?? []).filter((r) => r.active || r.id === f.responsibleId)
  const set = (p: Partial<TaskInput>) => onChange({ ...f, ...p })
  return (
    <div className="stack" style={{ gap: 10 }}>
      <textarea className="input" aria-label="Detalhes da tarefa" placeholder="Detalhes: material, onde fica, como fazer…" maxLength={2000} rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      <div className="field" style={{ margin: 0 }}>
        <div className="label">Prazo</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {(
            [
              ['Hoje', today],
              ['Amanhã', addDaysIso(today, 1)],
              ['Em 7 dias', addDaysIso(today, 7)],
            ] as const
          ).map(([l, d]) => (
            <button type="button" key={l} className={`chip${f.dueDate === d ? ' active' : ''}`} onClick={() => set({ dueDate: f.dueDate === d ? null : d })}>
              {l}
            </button>
          ))}
          <input type="date" className="input" style={{ flex: 1, minWidth: 150 }} aria-label="Data do prazo" value={f.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} />
        </div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <select className="input" aria-label="Responsável" value={f.responsibleId ?? ''} onChange={(e) => set({ responsibleId: e.target.value || null })}>
          <option value="">Responsável</option>
          {people.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Pasto" value={f.pastureId} onChange={(e) => set({ pastureId: e.target.value })}>
          <option value="">Geral (sem pasto)</option>
          {pastures.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <label className="row" style={{ gap: 10 }}>
        <input type="checkbox" checked={f.priority === 'alta'} onChange={(e) => set({ priority: e.target.checked ? 'alta' : 'normal' })} style={{ width: 22, height: 22 }} />
        <span>Prioridade alta</span>
      </label>
    </div>
  )
}

function TaskForm({ current, today, onClose }: { current: PastureTask; today: string; onClose: () => void }) {
  const [text, setText] = useState(current.description)
  const [fields, setFields] = useState<Omit<TaskInput, 'description'>>({
    notes: current.notes ?? '',
    pastureId: current.pastureId,
    dueDate: current.dueDate ?? null,
    responsibleId: current.responsibleId ?? null,
    priority: current.priority ?? 'normal',
  })
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await editTask(db, current.id, { description: text, ...fields })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="stack task-edit" data-testid="task-edit">
      <input className="input" aria-label="Tarefa" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
      <TaskFields value={fields} onChange={setFields} today={today} />
      {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className="row">
        <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
          <Icon name="check" /> Salvar
        </button>
      </div>
      <div className="row">
        {current.pastureId && (
          <Link to={`/pastos/${current.pastureId}`} className="btn btn-outline" style={{ flex: 1 }}>
            Abrir o pasto
          </Link>
        )}
        <button
          type="button"
          className="btn btn-danger"
          style={{ flex: 1 }}
          onClick={async () => {
            if (window.confirm(`Excluir a tarefa "${current.description}"?`)) {
              await removeTask(db, current.id)
              onClose()
            }
          }}
        >
          <Icon name="trash" /> Excluir
        </button>
      </div>
    </form>
  )
}

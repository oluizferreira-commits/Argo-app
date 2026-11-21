import { useState, type FormEvent } from 'react'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { PastureTask } from '../../db/types'
import { Icon } from '../../components/Icon'
import { addTask, PastureError, removeTask, setTaskDone, updateTask } from './pastures'

/** Serviços do pasto: anotar (com observação), editar, marcar como feito e remover. */
export function PastureTasks({ pastureId, tasks }: { pastureId: string; tasks: PastureTask[] }) {
  const [text, setText] = useState('')
  const [notes, setNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [key, setKey] = useState(newId)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sorted = [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt.localeCompare(a.createdAt))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await addTask(db, pastureId, text, key, notes)
      setText('')
      setNotes('')
      setShowNotes(false)
      setKey(newId())
    } catch (err) {
      setError(err instanceof PastureError ? err.message : (err as Error).message)
    }
  }

  return (
    <div className="card stack">
      <form onSubmit={submit} className="stack">
        <div className="row">
          <input
            className="input"
            value={text}
            maxLength={200}
            placeholder="Ex.: arrumar cerca da divisa"
            aria-label="Novo serviço"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-icon" style={{ minHeight: 56, width: 56 }} disabled={!text.trim()} aria-label="Adicionar serviço">
            <Icon name="plus" />
          </button>
        </div>
        {showNotes ? (
          <textarea
            className="input"
            aria-label="Observação do novo serviço"
            placeholder="Detalhes: o que precisa ser feito, material, onde fica…"
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        ) : (
          <button type="button" className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => setShowNotes(true)}>
            + Observação
          </button>
        )}
      </form>

      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="muted">Nenhum serviço anotado.</p>
      ) : (
        <div>
          {sorted.map((t) =>
            editing === t.id ? (
              <TaskEditor key={t.id} task={t} onClose={() => setEditing(null)} />
            ) : (
              <div key={t.id} className={`task${t.done ? ' done' : ''}`} style={{ alignItems: 'flex-start' }} data-testid="task">
                <button
                  className={`task-check${t.done ? ' done' : ''}`}
                  onClick={() => setTaskDone(db, t.id, !t.done)}
                  aria-label={t.done ? 'Marcar como não feito' : 'Marcar como feito'}
                  aria-pressed={t.done}
                >
                  {t.done && <Icon name="check" size={22} />}
                </button>
                <div className="status-body">
                  <div className="task-text" style={{ overflowWrap: 'anywhere', fontWeight: 600 }}>
                    {t.description}
                  </div>
                  {t.notes && (
                    <div className="task-notes" data-testid="task-notes">
                      {t.notes}
                    </div>
                  )}
                  <div className="status-detail">{t.done ? 'Feito' : 'A fazer'}</div>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  <button className="btn btn-outline btn-icon" onClick={() => setEditing(t.id)} aria-label={`Editar ${t.description}`}>
                    <Icon name="edit" size={20} />
                  </button>
                  <button
                    className="btn btn-danger btn-icon"
                    onClick={() => window.confirm('Remover este serviço da lista?') && removeTask(db, t.id)}
                    aria-label="Remover serviço"
                  >
                    <Icon name="trash" size={20} />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

function TaskEditor({ task, onClose }: { task: PastureTask; onClose: () => void }) {
  const [text, setText] = useState(task.description)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await updateTask(db, task.id, text, notes)
      onClose()
    } catch (err) {
      setError(err instanceof PastureError ? err.message : (err as Error).message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="stack task-editor">
      <label className="label" htmlFor={`te-${task.id}`}>
        Serviço
      </label>
      <input id={`te-${task.id}`} className="input" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />
      <label className="label" htmlFor={`tn-${task.id}`}>
        Observação
      </label>
      <textarea
        id={`tn-${task.id}`}
        className="input"
        placeholder="Detalhes: o que precisa ser feito, material, onde fica…"
        maxLength={2000}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{ minHeight: 120 }}
      />
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
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving || !text.trim()}>
          <Icon name="check" /> Salvar
        </button>
      </div>
    </form>
  )
}

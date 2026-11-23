/**
 * Tarefas da fazenda (aba Tarefas). Usa a mesma tabela dos serviços dos pastos: uma tarefa pode ser de um pasto
 * ou geral (pastureId = ''). Nada de lista paralela.
 */
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { PastureTask } from '../../db/types'
import { PastureError, TASK_NOTES_MAX } from '../pastos/pastures'

export interface TaskInput {
  description: string
  notes: string
  /** '' = tarefa geral */
  pastureId: string
  dueDate: string | null
  responsibleId: string | null
  priority: 'normal' | 'alta'
}

function clean(i: TaskInput): TaskInput {
  const description = i.description.trim().replace(/\s+/g, ' ')
  if (!description) throw new PastureError('Escreva a tarefa.')
  if (description.length > 200) throw new PastureError('Tarefa muito longa (máx. 200 caracteres). Use os detalhes para o resto.')
  const notes = i.notes.trim()
  if (notes.length > TASK_NOTES_MAX) throw new PastureError(`Detalhes muito longos (máx. ${TASK_NOTES_MAX} caracteres).`)
  if (i.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(i.dueDate)) throw new PastureError('Prazo inválido.')
  return { description, notes, pastureId: i.pastureId || '', dueDate: i.dueDate || null, responsibleId: i.responsibleId || null, priority: i.priority === 'alta' ? 'alta' : 'normal' }
}

export async function createTask(db: ArgoDatabase, farmId: string, input: TaskInput, key?: string): Promise<PastureTask> {
  const data = clean(input)
  return db.transaction('rw', [db.pastureTasks, db.pastures, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const ex = await db.pastureTasks.get(key)
      if (ex) return ex
    }
    if (data.pastureId) {
      const p = await db.pastures.get(data.pastureId)
      if (!p || p.farmId !== farmId || p.deletedAt !== null) throw new PastureError('Pasto não encontrado.')
    }
    return new Repository(db, 'pastureTasks').create({ farmId, ...data, done: false, doneAt: null }, key)
  })
}

/** Edita a tarefa (texto, detalhes, pasto, prazo, responsável, prioridade). Fica no histórico. */
export async function editTask(db: ArgoDatabase, id: string, input: TaskInput): Promise<PastureTask> {
  return new Repository(db, 'pastureTasks').update(id, clean(input))
}

export type TaskGroup = 'atrasadas' | 'hoje' | 'semana' | 'depois' | 'sem-prazo' | 'concluidas'
export const TASK_GROUPS: { id: TaskGroup; title: string }[] = [
  { id: 'atrasadas', title: 'Atrasadas' },
  { id: 'hoje', title: 'Hoje' },
  { id: 'semana', title: 'Próximos 7 dias' },
  { id: 'depois', title: 'Mais adiante' },
  { id: 'sem-prazo', title: 'Sem prazo' },
  { id: 'concluidas', title: 'Concluídas' },
]

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function taskGroup(t: Pick<PastureTask, 'done' | 'dueDate'>, today: string): TaskGroup {
  if (t.done) return 'concluidas'
  if (!t.dueDate) return 'sem-prazo'
  if (t.dueDate < today) return 'atrasadas'
  if (t.dueDate === today) return 'hoje'
  if (t.dueDate <= addDays(today, 7)) return 'semana'
  return 'depois'
}

/** Ordem: atrasadas → hoje → semana → depois → sem prazo; dentro do grupo, alta prioridade e prazo primeiro. */
export function sortTasks(list: readonly PastureTask[], today: string): PastureTask[] {
  const order = (g: TaskGroup) => TASK_GROUPS.findIndex((x) => x.id === g)
  return [...list].sort(
    (a, b) =>
      order(taskGroup(a, today)) - order(taskGroup(b, today)) ||
      Number(b.priority === 'alta') - Number(a.priority === 'alta') ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      (a.done ? (b.doneAt ?? '').localeCompare(a.doneAt ?? '') : a.createdAt.localeCompare(b.createdAt)),
  )
}

export { addDays as addDaysIso }

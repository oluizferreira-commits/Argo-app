/**
 * Diaristas: cadastro, calendário de diárias (um registro por trabalhador e dia), fechamento mensal e pagamentos.
 * O calendário calcula o valor DEVIDO; só o PAGAMENTO é saída financeira.
 */
import { nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Worker, WorkDay, WorkDayKind, WorkerPayment } from '../../db/types'
import { todayLocal } from '../rebanho/herd'

export class WorkerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerError'
  }
}

export const KIND_LABEL: Record<WorkDayKind, string> = {
  integral: 'Diária integral',
  meia: 'Meia diária',
  falta: 'Não trabalhou',
  'falta-justificada': 'Falta justificada',
  folga: 'Folga',
}

export const halfValue = (w: Pick<Worker, 'dailyCents' | 'halfCents'>) => w.halfCents ?? Math.round(w.dailyCents / 2)
export const workDayId = (workerId: string, date: string) => `${workerId}:${date}`

/** 0 = domingo … 6 = sábado */
export const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()

/** Marcação sugerida ao tocar no dia: seg–sex integral, sábado meia (até meio-dia), domingo integral (trabalho em domingo). */
export const defaultKind = (date: string): WorkDayKind => (weekday(date) === 6 ? 'meia' : 'integral')

export type DayState = WorkDayKind | 'domingo' | 'futuro' | 'antes' | 'nao-marcado'

/** Situação do dia no calendário. Dia passado sem registro (exceto domingo) = não trabalhou; hoje e futuro nunca são falta. */
export function dayState(w: Pick<Worker, 'startDate'>, date: string, day: WorkDay | undefined, today = todayLocal()): DayState {
  if (day && day.deletedAt === null) return day.kind
  if (date < w.startDate) return 'antes'
  if (date >= today) return 'futuro' // hoje sem marcação ainda não é falta (o dia não terminou)
  if (weekday(date) === 0) return 'domingo'
  return 'nao-marcado'
}

// ------------------------------------------------------------------ cadastro

export interface WorkerInput {
  name: string
  dailyCents: number
  halfCents: number | null
  halfReason: string
  startDate: string
  notes: string
}

function clean(i: WorkerInput): WorkerInput {
  const name = i.name.trim().replace(/\s+/g, ' ')
  if (!name) throw new WorkerError('Informe o nome completo.')
  if (!Number.isInteger(i.dailyCents) || i.dailyCents <= 0) throw new WorkerError('Informe o valor da diária.')
  if (i.halfCents !== null && (!Number.isInteger(i.halfCents) || i.halfCents <= 0 || i.halfCents > i.dailyCents)) throw new WorkerError('Meia diária inválida (deve ser até o valor da diária).')
  if (i.halfCents !== null && i.halfCents !== Math.round(i.dailyCents / 2) && !i.halfReason.trim()) throw new WorkerError('Informe o motivo da meia diária diferente da metade.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.startDate)) throw new WorkerError('Informe a data de início do trabalho.')
  return { name: name.slice(0, 80), dailyCents: i.dailyCents, halfCents: i.halfCents, halfReason: i.halfReason.trim().slice(0, 200), startDate: i.startDate, notes: i.notes.trim().slice(0, 1000) }
}

export async function createWorker(db: ArgoDatabase, farmId: string, input: WorkerInput, key?: string): Promise<Worker> {
  const data = clean(input)
  return db.transaction('rw', [db.workers, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const ex = await db.workers.get(key)
      if (ex) return ex
    }
    const dup = (await db.workers.where('farmId').equals(farmId).toArray()).find((w) => w.deletedAt === null && w.name.toLowerCase() === data.name.toLowerCase())
    if (dup) throw new WorkerError(`Já existe o trabalhador "${dup.name}".`)
    return new Repository(db, 'workers').create({ ...data, farmId, active: true }, key)
  })
}

/** Mudar o valor da diária vale para as próximas marcações (as já feitas guardam o valor da época). */
export async function updateWorker(db: ArgoDatabase, id: string, input: WorkerInput): Promise<Worker> {
  return new Repository(db, 'workers').update(id, clean(input))
}

export const setWorkerActive = (db: ArgoDatabase, id: string, active: boolean) => new Repository(db, 'workers').update(id, { active })

// ------------------------------------------------------------------ calendário

/** Marca (ou altera) um dia. O valor é guardado na marcação. Alterações ficam no histórico. */
export async function markDay(db: ArgoDatabase, farmId: string, workerId: string, date: string, kind: WorkDayKind, notes = '', opts: { operationId?: string } = {}): Promise<WorkDay> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new WorkerError('Data inválida.')
  if (date > todayLocal()) throw new WorkerError('Não dá para marcar uma data futura.')
  return db.transaction('rw', [db.workDays, db.workers, db.auditLog, db.outbox, db.meta], async () => {
    const w = await db.workers.get(workerId)
    if (!w || w.farmId !== farmId) throw new WorkerError('Trabalhador não encontrado.')
    if (date < w.startDate) throw new WorkerError('Antes da data de início do trabalho.')
    const valueCents = kind === 'integral' ? w.dailyCents : kind === 'meia' ? halfValue(w) : 0
    const id = workDayId(workerId, date)
    const repo = new Repository(db, 'workDays')
    const existing = await db.workDays.get(id)
    if (existing) {
      if (existing.operationId && existing.deletedAt === null && (kind !== 'integral' && kind !== 'meia'))
        throw new WorkerError('Esta diária está numa operação de campo: corrija a operação antes de mudar para falta ou folga.')
      if (existing.deletedAt !== null) await repo.restore(id)
      return repo.update(id, { kind, valueCents, notes: notes.trim().slice(0, 300), operationId: opts.operationId ?? existing.operationId })
    }
    return repo.create({ farmId, workerId, date, kind, valueCents, notes: notes.trim().slice(0, 300), operationId: opts.operationId ?? null }, id)
  })
}

/** Desmarca o dia (volta a ser "não marcado"). Fica no histórico. */
export async function clearDay(db: ArgoDatabase, workerId: string, date: string): Promise<void> {
  const d = await db.workDays.get(workDayId(workerId, date))
  if (!d || d.deletedAt !== null) return
  if (d.operationId) throw new WorkerError('Esta diária está numa operação de campo: corrija a operação antes.')
  await new Repository(db, 'workDays').softDelete(d.id)
}

// ------------------------------------------------------------------ fechamento e pagamentos

export interface MonthSummary {
  month: string
  daysWorked: number
  integral: number
  half: number
  absences: number
  justified: number
  dayOff: number
  dueCents: number
  paidCents: number
  balanceCents: number
}

const daysOf = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** Fechamento do mês: devido (calendário) × pago (pagamentos do mês de referência). */
export function monthSummary(w: Worker, days: readonly WorkDay[], payments: readonly WorkerPayment[], month: string, today = todayLocal()): MonthSummary {
  const byDate = new Map(days.filter((d) => d.workerId === w.id && d.deletedAt === null).map((d) => [d.date, d]))
  const s = { integral: 0, half: 0, absences: 0, justified: 0, dayOff: 0, dueCents: 0 }
  for (const date of daysOf(month)) {
    const st = dayState(w, date, byDate.get(date), today)
    const d = byDate.get(date)
    if (st === 'integral') s.integral++
    else if (st === 'meia') s.half++
    else if (st === 'falta' || st === 'nao-marcado') s.absences++
    else if (st === 'falta-justificada') s.justified++
    else if (st === 'folga') s.dayOff++
    if (d) s.dueCents += d.valueCents
  }
  const paidCents = payments.filter((p) => p.workerId === w.id && p.status === 'ativo' && p.deletedAt === null && p.refMonth === month).reduce((a, p) => a + p.amountCents, 0)
  return { month, daysWorked: s.integral + s.half, ...s, paidCents, balanceCents: s.dueCents - paidCents }
}

/** Valor que o dia teria pela diária atual. */
export const currentValue = (w: Pick<Worker, 'dailyCents' | 'halfCents'>, kind: WorkDayKind) => (kind === 'integral' ? w.dailyCents : kind === 'meia' ? halfValue(w) : 0)

/**
 * Dias marcados com valor diferente da diária atual (o valor é guardado na marcação: se a diária foi
 * alterada depois, os dias já marcados continuam com o valor antigo). `month` limita a um mês.
 */
export function outdatedDays(w: Worker, days: readonly WorkDay[], month?: string): WorkDay[] {
  return days.filter(
    (d) => d.workerId === w.id && d.deletedAt === null && (d.kind === 'integral' || d.kind === 'meia') && (!month || d.date.startsWith(month)) && d.valueCents !== currentValue(w, d.kind),
  )
}

/** Passa os dias com valor antigo para o valor da diária atual (cada alteração fica no histórico). */
export async function applyCurrentRate(db: ArgoDatabase, workerId: string, month?: string): Promise<number> {
  return db.transaction('rw', [db.workDays, db.workers, db.auditLog, db.outbox, db.meta], async () => {
    const w = await db.workers.get(workerId)
    if (!w) throw new WorkerError('Trabalhador não encontrado.')
    const list = outdatedDays(w, await db.workDays.where('workerId').equals(workerId).toArray(), month)
    const repo = new Repository(db, 'workDays')
    for (const d of list) await repo.update(d.id, { valueCents: currentValue(w, d.kind) })
    return list.length
  })
}

/** Saldo geral (todos os meses): devido − pago. */
export function workerBalance(w: Worker, days: readonly WorkDay[], payments: readonly WorkerPayment[]) {
  const due = days.filter((d) => d.workerId === w.id && d.deletedAt === null).reduce((a, d) => a + d.valueCents, 0)
  const paid = payments.filter((p) => p.workerId === w.id && p.status === 'ativo' && p.deletedAt === null).reduce((a, p) => a + p.amountCents, 0)
  return { dueCents: due, paidCents: paid, balanceCents: due - paid }
}

export interface PaymentInput {
  workerId: string
  date: string
  amountCents: number
  method: string
  refMonth: string
  notes: string
}

export async function recordWorkerPayment(db: ArgoDatabase, farmId: string, input: PaymentInput, key?: string): Promise<WorkerPayment> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new WorkerError('Informe a data do pagamento.')
  if (input.date > todayLocal()) throw new WorkerError('A data do pagamento não pode ser no futuro.')
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new WorkerError('Informe o valor pago.')
  if (!/^\d{4}-\d{2}$/.test(input.refMonth)) throw new WorkerError('Informe o mês de referência.')
  return db.transaction('rw', [db.workerPayments, db.workers, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const ex = await db.workerPayments.get(key)
      if (ex) return ex
    }
    const w = await db.workers.get(input.workerId)
    if (!w || w.farmId !== farmId) throw new WorkerError('Trabalhador não encontrado.')
    return new Repository(db, 'workerPayments').create(
      { farmId, workerId: w.id, date: input.date, amountCents: input.amountCents, method: input.method.trim().slice(0, 30) || 'Dinheiro', refMonth: input.refMonth, notes: input.notes.trim().slice(0, 300), status: 'ativo', reversedAt: null, reverseReason: '' },
      key,
    )
  })
}

export async function reverseWorkerPayment(db: ArgoDatabase, id: string, reason: string): Promise<WorkerPayment> {
  if (!reason.trim()) throw new WorkerError('Informe o motivo do estorno.')
  const p = await db.workerPayments.get(id)
  if (!p) throw new WorkerError('Pagamento não encontrado.')
  if (p.status === 'estornado') throw new WorkerError('Já estornado.')
  return new Repository(db, 'workerPayments').update(id, { status: 'estornado', reversedAt: nowIso(), reverseReason: reason.trim() })
}

/** Saída financeira com diaristas num mês (pagamentos efetivos, pela data do pagamento). */
export const workerExpense = (payments: readonly WorkerPayment[], month: string) =>
  payments.filter((p) => p.status === 'ativo' && p.deletedAt === null && p.date.startsWith(month)).reduce((a, p) => a + p.amountCents, 0)

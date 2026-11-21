/**
 * Manutenção programada (planos por horas e/ou dias), registros (com peças do estoque ou compradas direto),
 * solicitações (ex.: problema no checklist) e checklist diário. Reaproveita equipamentos, horímetro e estoque.
 */
import { newId, nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { ChecklistStatus, MachineChecklist, MaintenancePart, MaintenancePlan, MaintenanceRecord } from '../../db/types'
import { recordSupplyMovement, reverseSupplyMovement, unitOf } from '../insumos/supplies'
import { todayLocal } from '../rebanho/herd'
import { loadMeterContext, meterAt } from './machines'

export class MaintenanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaintenanceError'
  }
}

/** Sugestões de tipo (o produtor pode digitar qualquer outro). */
export const MAINTENANCE_SUGGESTIONS = [
  'Troca de óleo do motor',
  'Troca de filtro de óleo',
  'Troca de filtro de combustível',
  'Troca de filtro de ar',
  'Lubrificação',
  'Revisão geral',
  'Manutenção hidráulica',
  'Manutenção elétrica',
  'Manutenção de transmissão',
]

export const DEFAULT_CHECKLIST = [
  'Nível do óleo do motor',
  'Água e líquido de arrefecimento',
  'Combustível',
  'Vazamentos',
  'Pneus',
  'Filtros e entradas de ar',
  'Parte elétrica',
  'Freios',
  'Sistema hidráulico',
  'Pontos de lubrificação',
]
export const CHECK_LABEL: Record<ChecklistStatus, string> = { ok: 'Em ordem', atencao: 'Precisa de atenção', problema: 'Problema', na: 'Não se aplica' }

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)

// ------------------------------------------------------------------ planos

export interface PlanInput {
  equipmentId: string
  name: string
  intervalHours: number | null
  intervalDays: number | null
  warnHours: number | null
  warnDays: number | null
  baselineDate: string | null
  baselineMeter: number | null
  notes: string
}

function cleanPlan(i: PlanInput): PlanInput {
  const name = i.name.trim().replace(/\s+/g, ' ')
  if (!name) throw new MaintenanceError('Informe o tipo de manutenção (ex.: troca de óleo do motor).')
  if (i.intervalHours === null && i.intervalDays === null) throw new MaintenanceError('Informe o intervalo: em horas, em dias ou os dois.')
  if (i.intervalHours !== null && (!Number.isInteger(i.intervalHours) || i.intervalHours <= 0)) throw new MaintenanceError('Intervalo em horas inválido.')
  if (i.intervalDays !== null && (!Number.isInteger(i.intervalDays) || i.intervalDays <= 0)) throw new MaintenanceError('Intervalo em dias inválido.')
  if (i.warnHours !== null && (!Number.isInteger(i.warnHours) || i.warnHours < 0)) throw new MaintenanceError('Aviso em horas inválido.')
  if (i.warnDays !== null && (!Number.isInteger(i.warnDays) || i.warnDays < 0)) throw new MaintenanceError('Aviso em dias inválido.')
  if (i.baselineDate && !/^\d{4}-\d{2}-\d{2}$/.test(i.baselineDate)) throw new MaintenanceError('Data da última vez inválida.')
  return { ...i, name: name.slice(0, 60), notes: i.notes.trim().slice(0, 500) }
}

export async function createPlan(db: ArgoDatabase, farmId: string, input: PlanInput, key?: string): Promise<MaintenancePlan> {
  const data = cleanPlan(input)
  return db.transaction('rw', [db.maintenancePlans, db.equipments, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const existing = await db.maintenancePlans.get(key)
      if (existing) return existing
    }
    const eq = await db.equipments.get(data.equipmentId)
    if (!eq || eq.farmId !== farmId) throw new MaintenanceError('Máquina não encontrada.')
    const dup = (await db.maintenancePlans.where('equipmentId').equals(eq.id).toArray()).find((p) => p.deletedAt === null && p.active && p.name.toLowerCase() === data.name.toLowerCase())
    if (dup) throw new MaintenanceError(`Já existe o plano "${dup.name}" nesta máquina.`)
    return new Repository(db, 'maintenancePlans').create({ ...data, farmId, active: true }, key)
  })
}

export async function updatePlan(db: ArgoDatabase, id: string, input: PlanInput): Promise<MaintenancePlan> {
  const data = cleanPlan(input)
  return new Repository(db, 'maintenancePlans').update(id, { ...data })
}

export const setPlanActive = (db: ArgoDatabase, id: string, active: boolean) => new Repository(db, 'maintenancePlans').update(id, { active })

export interface PlanStatus {
  lastDate: string | null
  lastMeter: number | null
  nextMeter: number | null
  nextDate: string | null
  hoursLeft: number | null
  daysLeft: number | null
  state: 'ok' | 'proximo' | 'vencido' | 'sem-base'
}

/** Próxima manutenção: última feita (ou base) + intervalo. Horas OU data: vale o que vencer primeiro. */
export function planStatus(plan: MaintenancePlan, records: readonly MaintenanceRecord[], currentMeter: number | null, today = todayLocal()): PlanStatus {
  const last = records
    .filter((r) => r.planId === plan.id && r.status === 'concluida' && r.deletedAt === null && r.date)
    .sort((a, b) => b.date!.localeCompare(a.date!) || b.createdAt.localeCompare(a.createdAt))[0]
  const lastDate = last?.date ?? plan.baselineDate
  const lastMeter = last ? last.meter : plan.baselineMeter
  const nextMeter = plan.intervalHours !== null && lastMeter !== null ? lastMeter + plan.intervalHours : null
  const nextDate = plan.intervalDays !== null && lastDate ? addDays(lastDate, plan.intervalDays) : null
  const hoursLeft = nextMeter !== null && currentMeter !== null ? nextMeter - currentMeter : null
  const daysLeft = nextDate ? daysBetween(today, nextDate) : null
  let state: PlanStatus['state'] = nextMeter === null && nextDate === null ? 'sem-base' : 'ok'
  if ((hoursLeft !== null && hoursLeft <= (plan.warnHours ?? 0)) || (daysLeft !== null && daysLeft <= (plan.warnDays ?? 0))) state = 'proximo'
  if ((hoursLeft !== null && hoursLeft <= 0) || (daysLeft !== null && daysLeft < 0)) state = 'vencido'
  return { lastDate, lastMeter, nextMeter, nextDate, hoursLeft, daysLeft, state }
}

// ------------------------------------------------------------------ registros e solicitações

export interface MaintenanceInput {
  equipmentId: string
  planId: string | null
  kind: string
  date: string
  /** horímetro no momento (centésimos); null = usa o horímetro atual */
  meter: number | null
  responsibleId: string | null
  /** do estoque: supplyId + qty; comprado direto: description + costCents */
  parts: { supplyId: string | null; description: string; qty: number | null; costCents: number | null }[]
  serviceCents: number
  notes: string
}

const TABLES = (db: ArgoDatabase) => [
  db.maintenanceRecords,
  db.maintenancePlans,
  db.equipments,
  db.supplies,
  db.supplyMovements,
  db.pastures,
  db.machineSessions,
  db.fuelMovements,
  db.fieldOperations,
  db.meterAdjustments,
  db.auditLog,
  db.outbox,
  db.meta,
]

/**
 * Registra uma manutenção concluída (ou conclui uma solicitação, com `requestId`). Peças do estoque dão baixa
 * (custo médio, sem nova despesa); peças compradas direto e o serviço contam como despesa.
 */
export async function recordMaintenance(
  db: ArgoDatabase,
  farmId: string,
  input: MaintenanceInput,
  key?: string,
  opts: { requestId?: string; authorize?: { reason: string } } = {},
): Promise<MaintenanceRecord> {
  const kind = input.kind.trim().replace(/\s+/g, ' ')
  if (!kind) throw new MaintenanceError('Informe o tipo de manutenção.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new MaintenanceError('Informe a data.')
  if (input.date > todayLocal()) throw new MaintenanceError('A data não pode ser no futuro.')
  if (!Number.isInteger(input.serviceCents) || input.serviceCents < 0) throw new MaintenanceError('Valor do serviço inválido.')
  for (const p of input.parts) {
    if (p.supplyId) {
      if (!p.qty || p.qty <= 0) throw new MaintenanceError('Informe a quantidade de cada item do estoque.')
    } else {
      if (!p.description.trim()) throw new MaintenanceError('Descreva cada peça comprada (ex.: filtro de óleo).')
      if (!p.costCents || p.costCents <= 0) throw new MaintenanceError('Informe o valor de cada peça comprada.')
    }
  }
  const id = opts.requestId ?? key ?? newId()
  return db.transaction('rw', TABLES(db), async () => {
    const existing = await db.maintenanceRecords.get(id)
    if (existing && existing.status === 'concluida') return existing
    if (opts.requestId && (!existing || existing.status !== 'solicitada')) throw new MaintenanceError('Solicitação não encontrada ou já resolvida.')
    const eq = await db.equipments.get(input.equipmentId)
    if (!eq || eq.farmId !== farmId) throw new MaintenanceError('Máquina não encontrada.')
    if (input.planId) {
      const plan = await db.maintenancePlans.get(input.planId)
      if (!plan || plan.equipmentId !== eq.id) throw new MaintenanceError('Plano não encontrado.')
    }
    const meter = input.meter ?? meterAt(eq, await loadMeterContext(db, farmId))
    const parts: MaintenancePart[] = []
    for (const [i, p] of input.parts.entries()) {
      if (p.supplyId) {
        const s = await db.supplies.get(p.supplyId)
        if (!s || s.farmId !== farmId) throw new MaintenanceError('Produto do estoque não encontrado.')
        const unit = unitOf(s)
        const m = await recordSupplyMovement(
          db,
          farmId,
          { supplyId: s.id, type: 'consumo', date: input.date, halves: unit === 'saco' ? p.qty! : undefined, qty: unit === 'saco' ? undefined : p.qty!, maintenanceId: id, notes: `Manutenção · ${kind} · ${eq.name}` },
          `${id}-p${i + 1}`,
          opts.authorize,
        )
        parts.push({ supplyId: s.id, description: s.name, qty: p.qty, unit, costCents: m.costCents ?? 0, movementId: m.id })
      } else parts.push({ supplyId: null, description: p.description.trim().slice(0, 80), qty: null, unit: null, costCents: p.costCents!, movementId: null })
    }
    const stockCents = parts.filter((p) => p.supplyId).reduce((a, p) => a + p.costCents, 0)
    const directCents = parts.filter((p) => !p.supplyId).reduce((a, p) => a + p.costCents, 0) + input.serviceCents
    const data = {
      farmId,
      equipmentId: eq.id,
      planId: input.planId,
      kind: kind.slice(0, 60),
      status: 'concluida' as const,
      date: input.date,
      meter,
      responsibleId: input.responsibleId || null,
      parts,
      serviceCents: input.serviceCents,
      stockCents,
      directCents,
      notes: input.notes.trim().slice(0, 1000),
      cancelReason: '',
    }
    if (existing) return new Repository(db, 'maintenanceRecords').update(id, data)
    return new Repository(db, 'maintenanceRecords').create({ ...data, problem: '', checklistId: null }, id)
  })
}

/** Solicitação de manutenção (corretiva), ex.: aberta a partir de um problema no checklist. */
export async function requestMaintenance(db: ArgoDatabase, farmId: string, equipmentId: string, kind: string, problem: string, checklistId: string | null = null, key?: string): Promise<MaintenanceRecord> {
  if (!kind.trim()) throw new MaintenanceError('Informe o que precisa ser feito.')
  return new Repository(db, 'maintenanceRecords').create(
    {
      farmId,
      equipmentId,
      planId: null,
      kind: kind.trim().slice(0, 60),
      status: 'solicitada',
      date: null,
      meter: null,
      responsibleId: null,
      parts: [],
      serviceCents: 0,
      stockCents: 0,
      directCents: 0,
      notes: '',
      problem: problem.trim().slice(0, 1000),
      checklistId,
      cancelReason: '',
    },
    key,
  )
}

/** Cancela (estorna as peças do estoque). Fica no histórico com o motivo. */
export async function cancelMaintenance(db: ArgoDatabase, id: string, reason: string): Promise<MaintenanceRecord> {
  if (!reason.trim()) throw new MaintenanceError('Informe o motivo.')
  return db.transaction('rw', TABLES(db), async () => {
    const r = await db.maintenanceRecords.get(id)
    if (!r) throw new MaintenanceError('Manutenção não encontrada.')
    if (r.status === 'cancelada') throw new MaintenanceError('Já cancelada.')
    for (const p of r.parts) if (p.movementId) await reverseSupplyMovement(db, p.movementId, reason, true)
    return new Repository(db, 'maintenanceRecords').update(id, { status: 'cancelada', cancelReason: reason.trim() })
  })
}

// ------------------------------------------------------------------ checklist diário

export interface ChecklistInput {
  equipmentId: string
  responsibleId: string | null
  items: { label: string; status: ChecklistStatus | ''; note: string }[]
  photos: string[]
  notes: string
  /** abrir solicitação de manutenção com os problemas encontrados */
  openRequest: boolean
}

/** Grava a inspeção: só com TODOS os itens marcados. Problema → solicitação de manutenção (se pedido). */
export async function saveChecklist(db: ArgoDatabase, farmId: string, input: ChecklistInput, key?: string, now = nowIso()): Promise<MachineChecklist> {
  if (input.items.length === 0) throw new MaintenanceError('O checklist não tem itens.')
  const missing = input.items.filter((i) => !i.status)
  if (missing.length) throw new MaintenanceError(`Marque todos os itens antes de concluir (faltam ${missing.length}: ${missing.map((m) => m.label).join(', ')}).`)
  if (input.photos.length > 6) throw new MaintenanceError('No máximo 6 fotos por inspeção.')
  const id = key ?? newId()
  return db.transaction('rw', [db.machineChecklists, db.maintenanceRecords, db.equipments, db.auditLog, db.outbox, db.meta], async () => {
    const existing = await db.machineChecklists.get(id)
    if (existing) return existing
    const eq = await db.equipments.get(input.equipmentId)
    if (!eq || eq.farmId !== farmId) throw new MaintenanceError('Máquina não encontrada.')
    const problems = input.items.filter((i) => i.status === 'problema')
    let requestId: string | null = null
    if (input.openRequest && problems.length) {
      const r = await requestMaintenance(db, farmId, eq.id, `Problema no checklist: ${problems.map((p) => p.label).join(', ')}`.slice(0, 60), problems.map((p) => `${p.label}${p.note ? `: ${p.note}` : ''}`).join(' · '), id, `${id}-req`)
      requestId = r.id
    }
    return new Repository(db, 'machineChecklists').create(
      {
        farmId,
        equipmentId: eq.id,
        at: now,
        responsibleId: input.responsibleId || null,
        items: input.items.map((i) => ({ label: i.label, status: i.status as ChecklistStatus, note: i.note.trim().slice(0, 300) })),
        photos: input.photos,
        notes: input.notes.trim().slice(0, 1000),
        hasProblem: problems.length > 0,
        requestId,
      },
      id,
    )
  })
}

/** Itens do checklist da fazenda (configuráveis). */
export async function setChecklistItems(db: ArgoDatabase, farmId: string, items: string[]) {
  const clean = [...new Set(items.map((i) => i.trim()).filter(Boolean))].slice(0, 30)
  if (clean.length === 0) throw new MaintenanceError('O checklist precisa de pelo menos um item.')
  return new Repository(db, 'farms').update(farmId, { checklistItems: clean })
}

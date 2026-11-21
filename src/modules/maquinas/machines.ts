/**
 * Máquinas: horímetro digital (sessões com horários reais), horímetro acumulado e ajustes autorizados.
 * Reaproveita o cadastro de equipamentos do Diesel e as operações de campo (não há segundo horímetro).
 */
import { newId, nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Equipment, EquipmentStatus, FieldOperation, FieldOperationType, FuelMovement, MachineSession, MeterAdjustment } from '../../db/types'

export class MachineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MachineError'
  }
}

export const STATUS_LABEL: Record<EquipmentStatus, string> = { ativo: 'Ativo', parado: 'Parado', manutencao: 'Em manutenção', inativo: 'Inativo' }
export const equipmentStatus = (e: Pick<Equipment, 'status' | 'active'>): EquipmentStatus => e.status ?? (e.active ? 'ativo' : 'inativo')

// ------------------------------------------------------------------ tempo da sessão

const ms = (iso: string) => Date.parse(iso)

/** Segundos trabalhados: (fim ou agora) − início − pausas. Não depende de cronômetro rodando. */
export function sessionSeconds(s: Pick<MachineSession, 'startedAt' | 'endedAt' | 'pauses' | 'adjustedSeconds'>, now = nowIso()): number {
  if (s.adjustedSeconds != null) return s.adjustedSeconds
  const end = ms(s.endedAt ?? now)
  const paused = s.pauses.reduce((a, p) => a + Math.max(0, ms(p.end ?? s.endedAt ?? now) - ms(p.start)), 0)
  return Math.max(0, Math.round((end - ms(s.startedAt) - paused) / 1000))
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** "3 h 25 min" */
export function formatHoursMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

/** Horímetro em centésimos → "1.251,92 h". */
export function formatMeterH(hundredths: number | null): string {
  if (hundredths === null) return '—'
  return `${(hundredths / 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} h`
}

// ------------------------------------------------------------------ horímetro acumulado

export interface MeterContext {
  sessions: readonly MachineSession[]
  fuel: readonly FuelMovement[]
  operations: readonly FieldOperation[]
  adjustments: readonly MeterAdjustment[]
}

interface Reading {
  at: string
  value: number
  source: string
}

/** Leituras absolutas (centésimos): inicial, ajustes, leituras digitadas no diesel e nas operações. */
export function absoluteReadings(eq: Equipment, ctx: MeterContext): Reading[] {
  const out: Reading[] = []
  if (eq.meterInitial != null) out.push({ at: eq.meterInitialAt ?? eq.createdAt, value: eq.meterInitial, source: 'Horímetro inicial' })
  for (const a of ctx.adjustments) if (a.equipmentId === eq.id && a.deletedAt === null) out.push({ at: a.at, value: a.value, source: `Ajuste: ${a.reason}` })
  for (const f of ctx.fuel)
    if (f.equipmentId === eq.id && f.status === 'ativo' && f.deletedAt === null && f.meterReading !== null && !f.meterFromSession) out.push({ at: f.createdAt, value: f.meterReading * 10, source: 'Leitura no abastecimento' })
  for (const o of ctx.operations) {
    if (o.status !== 'concluida' || o.deletedAt !== null) continue
    for (const l of o.equipments)
      if (l.equipmentId === eq.id && !l.sessionId && l.meterEnd !== null && !l.fuelMovementId) out.push({ at: o.createdAt, value: l.meterEnd * 10, source: `Operação nº ${o.number}` })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

/**
 * Horímetro (centésimos de hora): última leitura absoluta até `at` + horas das sessões encerradas depois dela.
 * null = equipamento sem horímetro inicial nem leitura.
 */
export function meterAt(eq: Equipment, ctx: MeterContext, at = '9999'): number | null {
  if (eq.meter !== 'horimetro') return null
  const reads = absoluteReadings(eq, ctx).filter((r) => r.at <= at)
  const last = reads.at(-1)
  const since = last?.at ?? ''
  const extra = ctx.sessions
    .filter((s) => s.equipmentId === eq.id && s.deletedAt === null && s.status === 'encerrada' && s.endedAt !== null && s.endedAt > since && s.endedAt <= at)
    .reduce((a, s) => a + sessionSeconds(s), 0)
  if (!last && extra === 0) return null
  return (last?.value ?? 0) + Math.round(extra / 36)
}

/** Sessões de máquina em andamento (ou pausadas). */
export const openSessions = (sessions: readonly MachineSession[]) => sessions.filter((s) => s.deletedAt === null && (s.status === 'em-andamento' || s.status === 'pausada'))

// ------------------------------------------------------------------ serviço (início, pausa, fim)

export interface StartServiceInput {
  serviceType: FieldOperationType
  customType: string
  pastureId: string | null
  location: string
  machines: { equipmentId: string; responsibleId: string | null }[]
  notes: string
}

const TABLES = (db: ArgoDatabase) => [db.machineSessions, db.equipments, db.pastures, db.auditLog, db.outbox, db.meta]

/** INICIAR SERVIÇO: uma sessão por máquina, todas com o mesmo horário de início. */
export async function startService(db: ArgoDatabase, farmId: string, input: StartServiceInput, key?: string, now = nowIso()): Promise<string> {
  if (input.machines.length === 0) throw new MachineError('Escolha pelo menos uma máquina.')
  const ids = input.machines.map((m) => m.equipmentId)
  if (new Set(ids).size !== ids.length) throw new MachineError('A mesma máquina aparece duas vezes.')
  if (!input.pastureId && !input.location.trim()) throw new MachineError('Escolha o pasto ou informe o local.')
  if (input.serviceType === 'outra' && !input.customType.trim()) throw new MachineError('Informe qual é o serviço.')
  const serviceId = key ?? newId()
  return db.transaction('rw', TABLES(db), async () => {
    if ((await db.machineSessions.where('serviceId').equals(serviceId).count()) > 0) return serviceId
    const running = openSessions(await db.machineSessions.where('farmId').equals(farmId).toArray())
    if (input.pastureId) {
      const p = await db.pastures.get(input.pastureId)
      if (!p || p.farmId !== farmId || p.deletedAt !== null) throw new MachineError('Pasto não encontrado.')
    }
    const repo = new Repository(db, 'machineSessions')
    for (const [i, m] of input.machines.entries()) {
      const eq = await db.equipments.get(m.equipmentId)
      if (!eq || eq.farmId !== farmId || eq.deletedAt !== null) throw new MachineError('Máquina não encontrada.')
      const st = equipmentStatus(eq)
      if (st === 'inativo' || st === 'manutencao') throw new MachineError(`${eq.name} está ${STATUS_LABEL[st].toLowerCase()}: mude a situação antes de usar.`)
      if (running.some((r) => r.equipmentId === eq.id)) throw new MachineError(`${eq.name} já está em outro serviço em andamento. Encerre-o antes.`)
      await repo.create(
        {
          farmId,
          serviceId,
          equipmentId: eq.id,
          serviceType: input.serviceType,
          customType: input.customType.trim().slice(0, 60),
          pastureId: input.pastureId || null,
          location: input.location.trim().slice(0, 80),
          responsibleId: m.responsibleId ?? eq.responsibleId,
          startedAt: now,
          endedAt: null,
          pauses: [],
          status: 'em-andamento',
          workedSeconds: null,
          adjustedSeconds: null,
          adjustReason: '',
          operationId: null,
          notes: input.notes.trim().slice(0, 500),
        },
        `${serviceId}-m${i + 1}`,
      )
    }
    return serviceId
  })
}

async function updateSession(db: ArgoDatabase, id: string, fn: (s: MachineSession) => Partial<MachineSession>): Promise<MachineSession> {
  return db.transaction('rw', [db.machineSessions, db.auditLog, db.outbox, db.meta], async () => {
    const s = await db.machineSessions.get(id)
    if (!s || s.deletedAt !== null) throw new MachineError('Sessão não encontrada.')
    return new Repository(db, 'machineSessions').update(id, fn(s))
  })
}

export const pauseSession = (db: ArgoDatabase, id: string, now = nowIso()) =>
  updateSession(db, id, (s) => {
    if (s.status !== 'em-andamento') throw new MachineError('Só dá para pausar um serviço em andamento.')
    return { status: 'pausada', pauses: [...s.pauses, { start: now, end: null }] }
  })

export const resumeSession = (db: ArgoDatabase, id: string, now = nowIso()) =>
  updateSession(db, id, (s) => {
    if (s.status !== 'pausada') throw new MachineError('Este serviço não está pausado.')
    return { status: 'em-andamento', pauses: s.pauses.map((p) => (p.end === null ? { ...p, end: now } : p)) }
  })

/** ENCERRAR SERVIÇO: grava o horário de fim e as horas (uma vez só). */
export const endSession = (db: ArgoDatabase, id: string, now = nowIso()) =>
  updateSession(db, id, (s) => {
    if (s.status === 'encerrada') throw new MachineError('Este serviço já foi encerrado.')
    if (s.status === 'cancelada') throw new MachineError('Este serviço foi cancelado.')
    const pauses = s.pauses.map((p) => (p.end === null ? { ...p, end: now } : p))
    const worked = sessionSeconds({ ...s, pauses, endedAt: now, adjustedSeconds: null })
    return { status: 'encerrada', endedAt: now, pauses, workedSeconds: worked }
  })

/** Cancela uma sessão lançada por engano (não conta horas). Fica no histórico. */
export const cancelSession = (db: ArgoDatabase, id: string, reason: string, now = nowIso()) =>
  updateSession(db, id, (s) => {
    if (!reason.trim()) throw new MachineError('Informe o motivo.')
    if (s.operationId) throw new MachineError('As horas já estão numa operação: corrija pela operação.')
    if (s.status === 'cancelada') throw new MachineError('Já cancelada.')
    return { status: 'cancelada', endedAt: s.endedAt ?? now, adjustReason: reason.trim() }
  })

/** Ajuste autorizado do tempo de uma sessão encerrada (ex.: esqueceu de encerrar). Motivo obrigatório. */
export const adjustSessionTime = (db: ArgoDatabase, id: string, seconds: number, reason: string) =>
  updateSession(db, id, (s) => {
    if (s.status !== 'encerrada') throw new MachineError('Encerre o serviço antes de ajustar o tempo.')
    if (s.operationId) throw new MachineError('As horas já estão numa operação: corrija pela operação.')
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 24 * 3600) throw new MachineError('Tempo inválido (máximo 24 h).')
    if (!reason.trim()) throw new MachineError('Informe o motivo do ajuste.')
    return { adjustedSeconds: seconds, adjustReason: reason.trim() }
  })

/** Ajuste autorizado do horímetro (valor absoluto). Motivo obrigatório; fica no histórico. */
export async function adjustMeter(db: ArgoDatabase, farmId: string, equipmentId: string, value: number, reason: string, now = nowIso()): Promise<MeterAdjustment> {
  if (!Number.isInteger(value) || value < 0) throw new MachineError('Horímetro inválido.')
  if (!reason.trim()) throw new MachineError('Informe o motivo do ajuste.')
  const eq = await db.equipments.get(equipmentId)
  if (!eq || eq.farmId !== farmId) throw new MachineError('Máquina não encontrada.')
  if (eq.meter !== 'horimetro') throw new MachineError('Esta máquina não usa horímetro.')
  return new Repository(db, 'meterAdjustments').create({ farmId, equipmentId, value, reason: reason.trim().slice(0, 200), at: now })
}

/** Carrega o contexto do horímetro de uma fazenda (para serviços que calculam leituras). */
export async function loadMeterContext(db: ArgoDatabase, farmId: string): Promise<MeterContext> {
  const [sessions, fuel, operations, adjustments] = await Promise.all([
    db.machineSessions.where('farmId').equals(farmId).toArray(),
    db.fuelMovements.where('farmId').equals(farmId).toArray(),
    db.fieldOperations.where('farmId').equals(farmId).toArray(),
    db.meterAdjustments.where('farmId').equals(farmId).toArray(),
  ])
  return { sessions, fuel, operations, adjustments }
}

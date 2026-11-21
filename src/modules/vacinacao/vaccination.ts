import { nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Vaccination, VaccinationApplication } from '../../db/types'
import { todayLocal } from '../rebanho/herd'

export class VaccinationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaccinationError'
  }
}

// ------------------------------------------------------------------ cobertura

export interface Coverage {
  planned: number
  /** soma das aplicações ativas (estornadas não contam) */
  vaccinated: number
  /** previstos que ainda não foram vacinados — nunca contam como vacinados */
  pending: number
  /** 0–100, arredondado para baixo (só chega a 100 quando não falta nenhum) */
  percent: number
  status: 'nao-iniciada' | 'parcial' | 'completa'
}

const activeApp = (a: VaccinationApplication) => a.status === 'ativo' && a.deletedAt === null

export function coverageOf(planned: number, vaccinated: number): Coverage {
  const pending = Math.max(0, planned - vaccinated)
  const percent = planned > 0 ? Math.floor((vaccinated * 100) / planned) : 0
  return { planned, vaccinated, pending, percent, status: vaccinated === 0 ? 'nao-iniciada' : pending === 0 ? 'completa' : 'parcial' }
}

export function coverage(v: Pick<Vaccination, 'id' | 'plannedQty'>, apps: readonly VaccinationApplication[]): Coverage {
  return coverageOf(v.plannedQty, apps.filter((a) => a.vaccinationId === v.id && activeApp(a)).reduce((s, a) => s + a.quantity, 0))
}

export const STATUS_LABEL: Record<Coverage['status'], string> = { 'nao-iniciada': 'Não iniciada', parcial: 'Parcial', completa: 'Completa' }

/** "Pasto Grande · Bezerras" ou "Pasto Grande · todo o pasto". */
export function lotLabel(pastureName: string, lot: string): string {
  return `${pastureName} · ${lot.trim() || 'todo o pasto'}`
}

// ------------------------------------------------------------------ campanha

export interface VaccinationInput {
  pastureId: string
  lot: string
  vaccine: string
  product: string
  plannedQty: number
  responsibleId: string | null
  nextDate: string | null
  notes: string
}

export interface ApplicationInput {
  date: string
  quantity: number
  responsibleId: string | null
  notes: string
}

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)

function cleanVaccination(i: VaccinationInput): VaccinationInput {
  const vaccine = i.vaccine.trim().replace(/\s+/g, ' ')
  if (!i.pastureId) throw new VaccinationError('Escolha o pasto.')
  if (!vaccine) throw new VaccinationError('Informe a vacina (ex.: aftosa, brucelose, clostridiose).')
  if (!Number.isInteger(i.plannedQty) || i.plannedQty <= 0) throw new VaccinationError('Informe a quantidade prevista de animais.')
  if (i.plannedQty > 100000) throw new VaccinationError('Quantidade prevista muito alta. Confira o número.')
  if (i.nextDate !== null && !isDate(i.nextDate)) throw new VaccinationError('Data da próxima vacinação inválida.')
  return {
    pastureId: i.pastureId,
    lot: i.lot.trim().replace(/\s+/g, ' ').slice(0, 60),
    vaccine: vaccine.slice(0, 60),
    product: i.product.trim().slice(0, 80),
    plannedQty: i.plannedQty,
    responsibleId: i.responsibleId || null,
    nextDate: i.nextDate,
    notes: i.notes.trim().slice(0, 1000),
  }
}

function checkApplication(a: ApplicationInput, pending: number) {
  if (!isDate(a.date)) throw new VaccinationError('Informe a data da aplicação.')
  if (a.date > todayLocal()) throw new VaccinationError('A data da aplicação não pode ser no futuro.')
  if (!Number.isInteger(a.quantity) || a.quantity <= 0) throw new VaccinationError('Informe quantos animais foram vacinados.')
  if (a.quantity > pending)
    throw new VaccinationError(`Só faltam ${pending} animal(is) para vacinar neste lote. Se o lote aumentou, corrija antes a quantidade prevista.`)
}

const key3 = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim()

/**
 * Cria a campanha do lote e, se informada, a primeira aplicação. Não deixa abrir outra campanha igual
 * (mesmo pasto, lote e vacina) enquanto a anterior tiver animais pendentes.
 */
export async function createVaccination(
  db: ArgoDatabase,
  farmId: string,
  input: VaccinationInput,
  first: ApplicationInput | null,
  key?: string,
  fromId?: string,
): Promise<Vaccination> {
  const data = cleanVaccination(input)
  if (first) checkApplication(first, data.plannedQty)
  if (first && data.nextDate && data.nextDate <= first.date) throw new VaccinationError('A próxima vacinação deve ser depois da data da aplicação.')
  return db.transaction('rw', [db.vaccinations, db.vaccinationApplications, db.pastures, db.responsibles, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const existing = await db.vaccinations.get(key)
      if (existing) return existing
    }
    const pasture = await db.pastures.get(data.pastureId)
    if (!pasture || pasture.farmId !== farmId || pasture.deletedAt !== null) throw new VaccinationError('Pasto não encontrado.')
    for (const rid of [data.responsibleId, first?.responsibleId]) {
      if (!rid) continue
      const r = await db.responsibles.get(rid)
      if (!r || r.farmId !== farmId) throw new VaccinationError('Responsável não encontrado.')
    }
    const all = (await db.vaccinations.where('farmId').equals(farmId).toArray()).filter((v) => v.deletedAt === null)
    const apps = await db.vaccinationApplications.where('farmId').equals(farmId).toArray()
    const open = all.find(
      (v) => v.pastureId === data.pastureId && key3(v.lot) === key3(data.lot) && key3(v.vaccine) === key3(data.vaccine) && coverage(v, apps).pending > 0,
    )
    if (open) throw new VaccinationError(`Já existe uma vacinação de ${open.vaccine} em andamento neste lote. Registre a nova aplicação nela.`)
    const v = await new Repository(db, 'vaccinations').create({ ...data, farmId, followUpId: null }, key)
    if (first)
      await new Repository(db, 'vaccinationApplications').create(
        { farmId, vaccinationId: v.id, date: first.date, quantity: first.quantity, responsibleId: first.responsibleId || data.responsibleId, notes: first.notes.trim(), status: 'ativo', reversedAt: null, reverseReason: '' },
        key ? `${key}-1` : undefined,
      )
    if (fromId) {
      const prev = await db.vaccinations.get(fromId)
      if (prev && prev.farmId === farmId) await new Repository(db, 'vaccinations').update(fromId, { followUpId: v.id })
    }
    return v
  })
}

/** Corrige dados da campanha. A quantidade prevista não pode ficar menor que a já vacinada. */
export async function updateVaccination(db: ArgoDatabase, id: string, input: VaccinationInput): Promise<Vaccination> {
  const data = cleanVaccination(input)
  return db.transaction('rw', [db.vaccinations, db.vaccinationApplications, db.auditLog, db.outbox, db.meta], async () => {
    const v = await db.vaccinations.get(id)
    if (!v) throw new VaccinationError('Vacinação não encontrada.')
    const c = coverage(v, await db.vaccinationApplications.where('vaccinationId').equals(id).toArray())
    if (data.plannedQty < c.vaccinated) throw new VaccinationError(`Já foram vacinados ${c.vaccinated}: a quantidade prevista não pode ser menor.`)
    return new Repository(db, 'vaccinations').update(id, { ...data, pastureId: v.pastureId })
  })
}

/** Nova aplicação na campanha (ex.: os 20 que faltaram). Não apaga as anteriores. */
export async function addApplication(db: ArgoDatabase, vaccinationId: string, input: ApplicationInput, key?: string): Promise<VaccinationApplication> {
  return db.transaction('rw', [db.vaccinations, db.vaccinationApplications, db.responsibles, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const existing = await db.vaccinationApplications.get(key)
      if (existing) return existing
    }
    const v = await db.vaccinations.get(vaccinationId)
    if (!v || v.deletedAt !== null) throw new VaccinationError('Vacinação não encontrada.')
    const c = coverage(v, await db.vaccinationApplications.where('vaccinationId').equals(vaccinationId).toArray())
    checkApplication(input, c.pending)
    if (input.responsibleId) {
      const r = await db.responsibles.get(input.responsibleId)
      if (!r || r.farmId !== v.farmId) throw new VaccinationError('Responsável não encontrado.')
    }
    return new Repository(db, 'vaccinationApplications').create(
      { farmId: v.farmId, vaccinationId, date: input.date, quantity: input.quantity, responsibleId: input.responsibleId || null, notes: input.notes.trim(), status: 'ativo', reversedAt: null, reverseReason: '' },
      key,
    )
  })
}

/** Estorna uma aplicação lançada errada (fica no histórico; os animais voltam a pendentes). */
export async function reverseApplication(db: ArgoDatabase, id: string, reason: string): Promise<VaccinationApplication> {
  if (!reason.trim()) throw new VaccinationError('Informe o motivo do estorno.')
  return db.transaction('rw', [db.vaccinationApplications, db.auditLog, db.outbox, db.meta], async () => {
    const a = await db.vaccinationApplications.get(id)
    if (!a) throw new VaccinationError('Aplicação não encontrada.')
    if (a.status === 'estornado') throw new VaccinationError('Esta aplicação já foi estornada.')
    return new Repository(db, 'vaccinationApplications').update(id, { status: 'estornado', reversedAt: nowIso(), reverseReason: reason.trim() })
  })
}

import { nowIso } from '../../core/ids'
import { parseDecimal } from '../../core/money'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Equipment, FuelMovement } from '../../db/types'
import { todayLocal } from '../rebanho/herd'

export class FuelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FuelError'
  }
}

/** Saída que deixaria o estoque de diesel negativo: precisa de autorização explícita. */
export class FuelNegativeError extends FuelError {
  constructor(availableCl: number) {
    super(`Diesel insuficiente: há ${formatLiters(availableCl)}. Para lançar assim mesmo, é preciso autorizar.`)
    this.name = 'FuelNegativeError'
  }
}

// ------------------------------------------------------------------ unidades

/** "150" → 15000 cL; "150,5" → 15050 cL. Até 2 casas. */
export function parseLiters(text: string): number {
  const cl = parseDecimal(text, 2)
  if (cl === null) throw new FuelError('Informe os litros (ex.: 150 ou 150,5).')
  if (cl <= 0) throw new FuelError('A quantidade de litros deve ser maior que zero.')
  if (cl > 10_000_000) throw new FuelError('Quantidade muito alta. Confira o número.')
  return cl
}

export function formatLiters(cl: number): string {
  return `${(cl / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L`
}

/** Horímetro (horas) ou hodômetro (km) com até 1 casa → ×10. */
export function parseMeter(text: string): number | null {
  if (!text.trim()) return null
  const v = parseDecimal(text, 1)
  if (v === null) throw new FuelError('Leitura inválida (use até 1 casa decimal, ex.: 1250,5).')
  return v
}

export function formatMeter(v: number | null, meter: Equipment['meter']): string {
  if (v === null) return '—'
  const n = (v / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  return meter === 'km' ? `${n} km` : `${n} h`
}

/** Preço por litro em centavos (arredondado) a partir do total e dos centilitros. */
export const pricePerLiter = (totalCents: number, cl: number) => Math.round((totalCents * 100) / cl)

export const METER_LABEL: Record<Equipment['meter'], string> = { horimetro: 'Horímetro', km: 'Hodômetro (km)', nenhum: 'Sem medidor' }

// ------------------------------------------------------------------ custo médio ponderado

export interface FuelLedgerLine {
  movement: FuelMovement
  /** custo do lançamento (saídas: litros × custo médio do momento; compras: valor pago) */
  costCents: number
  /** custo médio por litro após o lançamento (centavos/L) */
  avgCents: number
  balanceCl: number
}

/** Ordem cronológica: data e, no mesmo dia, ordem de lançamento. */
const chrono = (a: FuelMovement, b: FuelMovement) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
const activeMov = (m: FuelMovement) => m.status === 'ativo' && m.deletedAt === null

/**
 * Estoque e custo médio ponderado: cada compra recalcula o custo médio
 * ((valor em estoque + valor da compra) ÷ (litros em estoque + litros comprados));
 * cada saída sai pelo custo médio do momento.
 */
export function fuelLedger(movements: readonly FuelMovement[]): { lines: FuelLedgerLine[]; balanceCl: number; avgCents: number; valueCents: number } {
  let balance = 0
  let value = 0 // centavos (valor do estoque)
  let avg = 0 // centavos por litro
  const lines: FuelLedgerLine[] = []
  for (const m of movements.filter(activeMov).sort(chrono)) {
    let cost: number
    if (m.type === 'compra' && m.totalCents !== null) {
      cost = m.totalCents
      if (balance <= 0) {
        // estoque zerado ou negativo: o custo passa a ser o preço desta compra
        avg = pricePerLiter(m.totalCents, m.centiliters)
        balance += m.centiliters
        value = Math.round((balance * avg) / 100)
      } else {
        balance += m.centiliters
        value += m.totalCents
        avg = Math.round((value * 100) / balance)
      }
    } else {
      cost = Math.round((Math.abs(m.centiliters) * avg) / 100)
      balance += m.centiliters
      value = balance > 0 ? Math.round((balance * avg) / 100) : 0
    }
    lines.push({ movement: m, costCents: cost, avgCents: avg, balanceCl: balance })
  }
  return { lines, balanceCl: balance, avgCents: avg, valueCents: Math.max(0, value) }
}

export function fuelStock(movements: readonly FuelMovement[]): number {
  return movements.filter(activeMov).reduce((a, m) => a + m.centiliters, 0)
}

// ------------------------------------------------------------------ equipamentos

export interface EquipmentInput {
  name: string
  type: string
  identification: string
  responsibleId: string | null
  meter: Equipment['meter']
}

function cleanEquipment(i: EquipmentInput): EquipmentInput {
  const name = i.name.trim().replace(/\s+/g, ' ')
  if (!name) throw new FuelError('Informe o nome do equipamento.')
  if (name.length > 60) throw new FuelError('Nome muito longo (máx. 60 caracteres).')
  if (!['horimetro', 'km', 'nenhum'].includes(i.meter)) throw new FuelError('Escolha o medidor.')
  return { name, type: i.type.trim().slice(0, 40), identification: i.identification.trim().slice(0, 40), responsibleId: i.responsibleId || null, meter: i.meter }
}

async function assertUniqueEquipment(db: ArgoDatabase, farmId: string, name: string, exceptId?: string) {
  const key = name.toLocaleLowerCase('pt-BR')
  const clash = (await db.equipments.where('farmId').equals(farmId).toArray()).find(
    (e) => e.deletedAt === null && e.id !== exceptId && e.name.toLocaleLowerCase('pt-BR') === key,
  )
  if (clash) throw new FuelError(`Já existe o equipamento "${clash.name}".`)
}

export async function createEquipment(db: ArgoDatabase, farmId: string, input: EquipmentInput, key?: string): Promise<Equipment> {
  const data = cleanEquipment(input)
  return db.transaction('rw', [db.equipments, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const existing = await db.equipments.get(key)
      if (existing) return existing
    }
    await assertUniqueEquipment(db, farmId, data.name)
    return new Repository(db, 'equipments').create({ ...data, farmId, active: true }, key)
  })
}

export async function updateEquipment(db: ArgoDatabase, e: Equipment, input: EquipmentInput): Promise<Equipment> {
  const data = cleanEquipment(input)
  return db.transaction('rw', [db.equipments, db.auditLog, db.outbox, db.meta], async () => {
    await assertUniqueEquipment(db, e.farmId, data.name, e.id)
    return new Repository(db, 'equipments').update(e.id, data)
  })
}

/** Equipamentos não são apagados (o histórico de abastecimentos aponta para eles): são desativados. */
export async function setEquipmentActive(db: ArgoDatabase, id: string, active: boolean): Promise<Equipment> {
  return new Repository(db, 'equipments').update(id, { active })
}

/** Última leitura do medidor de um equipamento (abastecimentos ativos). */
export function lastMeterReading(movements: readonly FuelMovement[], equipmentId: string, before?: { date: string }): FuelMovement | undefined {
  return movements
    .filter((m) => activeMov(m) && m.equipmentId === equipmentId && m.meterReading !== null && (!before || m.date <= before.date))
    .sort(chrono)
    .at(-1)
}

// ------------------------------------------------------------------ movimentos

export interface FuelMovementInput {
  type: 'compra' | 'consumo' | 'ajuste'
  date: string
  /** litros em centilitros, positivo */
  centiliters: number
  direction?: 'entrada' | 'saida'
  totalCents?: number | null
  station?: string
  equipmentId?: string | null
  responsibleId?: string | null
  meterReading?: number | null
  notes?: string
}

export async function recordFuelMovement(
  db: ArgoDatabase,
  farmId: string,
  input: FuelMovementInput,
  key?: string,
  authorize?: { reason: string },
): Promise<FuelMovement> {
  if (!Number.isInteger(input.centiliters) || input.centiliters <= 0) throw new FuelError('Informe os litros.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new FuelError('Informe a data.')
  if (input.date > todayLocal()) throw new FuelError('A data não pode ser no futuro.')
  const notes = (input.notes ?? '').trim()
  const station = (input.station ?? '').trim()
  let sign = 1
  if (input.type === 'compra') {
    if (!input.totalCents || input.totalCents <= 0) throw new FuelError('Informe o valor total pago.')
    if (!station) throw new FuelError('Informe o posto.')
  } else if (input.type === 'consumo') {
    if (!input.equipmentId) throw new FuelError('Escolha o equipamento.')
    sign = -1
  } else if (input.type === 'ajuste') {
    if (!input.direction) throw new FuelError('Escolha se o ajuste é entrada ou saída.')
    if (!notes) throw new FuelError('Informe o motivo do ajuste.')
    sign = input.direction === 'entrada' ? 1 : -1
  } else throw new FuelError('Tipo de lançamento inválido.')

  return db.transaction('rw', [db.fuelMovements, db.equipments, db.responsibles, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const existing = await db.fuelMovements.get(key)
      if (existing) return existing
    }
    const all = await db.fuelMovements.where('farmId').equals(farmId).toArray()
    let meterReading: number | null = null
    if (input.type === 'consumo') {
      const eq = await db.equipments.get(input.equipmentId!)
      if (!eq || eq.farmId !== farmId || eq.deletedAt !== null) throw new FuelError('Equipamento não encontrado.')
      if (eq.meter !== 'nenhum' && input.meterReading != null) {
        if (!Number.isInteger(input.meterReading) || input.meterReading < 0) throw new FuelError('Leitura inválida.')
        const last = lastMeterReading(all, eq.id, { date: input.date })
        if (last && last.meterReading! > input.meterReading)
          throw new FuelError(`A leitura não pode ser menor que a anterior (${formatMeter(last.meterReading, eq.meter)} em ${last.date.split('-').reverse().join('/')}).`)
        meterReading = input.meterReading
      }
    }
    if (input.responsibleId) {
      const r = await db.responsibles.get(input.responsibleId)
      if (!r || r.farmId !== farmId || r.deletedAt !== null) throw new FuelError('Responsável não encontrado.')
    }
    let authorized = false
    if (sign < 0) {
      const stock = fuelStock(all)
      if (stock - input.centiliters < 0) {
        if (!authorize?.reason.trim()) throw new FuelNegativeError(stock)
        authorized = true
      }
    }
    return new Repository(db, 'fuelMovements').create(
      {
        farmId,
        type: input.type,
        date: input.date,
        centiliters: sign * input.centiliters,
        totalCents: input.type === 'compra' ? input.totalCents! : null,
        station: input.type === 'compra' ? station : '',
        equipmentId: input.type === 'consumo' ? input.equipmentId! : null,
        responsibleId: input.type === 'ajuste' ? null : (input.responsibleId ?? null),
        meterReading,
        notes: authorized ? `${notes ? `${notes} · ` : ''}Estoque negativo autorizado: ${authorize!.reason.trim()}` : notes,
        authorizedNegative: authorized,
        status: 'ativo',
        reversedAt: null,
        reverseReason: '',
      },
      key,
    )
  })
}

/** Estorna um lançamento (fica no histórico). Estornar uma entrada não pode deixar o estoque negativo. */
export async function reverseFuelMovement(db: ArgoDatabase, id: string, reason: string): Promise<FuelMovement> {
  return db.transaction('rw', [db.fuelMovements, db.auditLog, db.outbox, db.meta], async () => {
    const m = await db.fuelMovements.get(id)
    if (!m) throw new FuelError('Lançamento não encontrado.')
    if (m.status === 'estornado') throw new FuelError('Este lançamento já foi estornado.')
    if (m.centiliters > 0) {
      const stock = fuelStock(await db.fuelMovements.where('farmId').equals(m.farmId).toArray())
      if (stock - m.centiliters < 0) throw new FuelError('Não é possível estornar: o estoque ficaria negativo (o diesel já foi usado).')
    }
    return new Repository(db, 'fuelMovements').update(id, { status: 'estornado', reversedAt: nowIso(), reverseReason: reason.trim() })
  })
}


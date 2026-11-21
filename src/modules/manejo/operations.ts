/**
 * Operações de campo (herbicida, plantio, replantio, recuperação, outra).
 * Nada de estoque paralelo: cada produto usado vira um consumo no estoque de Insumos e cada diesel
 * vira UM consumo no Diesel, todos ligados à operação (operationId). Os custos são guardados na
 * operação no momento do lançamento (custo médio ponderado de cada estoque) e preservam o histórico.
 */
import { newId, nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { FieldOperation, FieldOperationEquipment, FieldOperationProduct, FieldOperationType, FuelMovement } from '../../db/types'
import { formatLiters, fuelLedger, recordFuelMovement, reverseFuelMovement } from '../diesel/fuel'
import { categoryOf, formatQty, recordSupplyMovement, reverseSupplyMovement, unitOf } from '../insumos/supplies'
import { todayLocal } from '../rebanho/herd'

export class OperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperationError'
  }
}

export const OPERATION_TYPES: { id: FieldOperationType; label: string; short: string }[] = [
  { id: 'herbicida', label: 'Aplicação de herbicida', short: 'Herbicida' },
  { id: 'plantio', label: 'Plantio de capim', short: 'Plantio' },
  { id: 'replantio', label: 'Replantio', short: 'Replantio' },
  { id: 'recuperacao', label: 'Recuperação de pastagem', short: 'Recuperação' },
  { id: 'outra', label: 'Outra operação de manejo', short: 'Outra' },
]
export const typeLabel = (t: FieldOperationType) => OPERATION_TYPES.find((x) => x.id === t)?.label ?? t
/** Formação = plantio e replantio; manutenção = herbicida, recuperação e outras. */
export const isFormation = (t: FieldOperationType) => t === 'plantio' || t === 'replantio'
const needsSeeds = (t: FieldOperationType) => t === 'plantio' || t === 'replantio'

export interface OperationInput {
  type: FieldOperationType
  date: string
  pastureId: string
  /** área trabalhada em centésimos de hectare */
  workedAreaCentiHa: number
  responsibleId: string | null
  products: { supplyId: string; qty: number; lot?: string }[]
  equipments: { equipmentId: string; responsibleId: string | null; meterStart: number | null; meterEnd: number | null; hoursTenths: number | null; dieselCl: number }[]
  otherCosts: { description: string; costCents: number }[]
  notes: string
}

/** Horas trabalhadas: pela diferença do horímetro quando houver as duas leituras, senão as horas digitadas. */
export function workedHours(e: Pick<FieldOperationEquipment, 'meterStart' | 'meterEnd' | 'hoursTenths'>): number | null {
  if (e.meterStart !== null && e.meterEnd !== null) return e.meterEnd - e.meterStart
  return e.hoursTenths
}

/** Custo por hectare trabalhado (centavos/ha). */
export function costPerHa(op: Pick<FieldOperation, 'totalCents' | 'workedAreaCentiHa'>): number {
  return op.workedAreaCentiHa > 0 ? Math.round((op.totalCents * 100) / op.workedAreaCentiHa) : 0
}

export function formatHa(centiHa: number | null): string {
  if (centiHa === null) return '—'
  return `${(centiHa / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`
}

export const formatHours = (tenths: number | null) => (tenths === null ? '—' : `${(tenths / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`)

/** Diesel: custo de uma saída pelo custo médio do estoque na data. */
function dieselCost(movs: readonly FuelMovement[], date: string, cl: number): number {
  const probe = { id: '__op__', type: 'consumo', date, centiliters: -cl, totalCents: null, status: 'ativo', deletedAt: null, createdAt: '9999' } as unknown as FuelMovement
  return fuelLedger([...movs, probe]).lines.find((l) => l.movement.id === '__op__')?.costCents ?? 0
}

const TABLES = (db: ArgoDatabase) => [
  db.fieldOperations,
  db.supplies,
  db.supplyMovements,
  db.fuelMovements,
  db.equipments,
  db.responsibles,
  db.pastures,
  db.auditLog,
  db.outbox,
  db.meta,
]

function validate(input: OperationInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new OperationError('Informe a data.')
  if (input.date > todayLocal()) throw new OperationError('A data não pode ser no futuro.')
  if (!input.pastureId) throw new OperationError('Escolha o pasto.')
  if (!Number.isInteger(input.workedAreaCentiHa) || input.workedAreaCentiHa <= 0) throw new OperationError('Informe a área trabalhada (ha).')
  if (input.products.some((p) => !p.supplyId || !Number.isInteger(p.qty) || p.qty <= 0)) throw new OperationError('Informe a quantidade de cada produto.')
  const pk = input.products.map((p) => `${p.supplyId}|${(p.lot ?? '').trim().toLowerCase()}`)
  if (new Set(pk).size !== pk.length) throw new OperationError('O mesmo produto (e lote) aparece duas vezes. Junte as quantidades numa linha.')
  const ek = input.equipments.map((e) => e.equipmentId)
  if (ek.some((x) => !x)) throw new OperationError('Escolha o equipamento de cada linha.')
  if (new Set(ek).size !== ek.length) throw new OperationError('O mesmo equipamento aparece duas vezes.')
  for (const e of input.equipments) {
    if (e.meterStart !== null && e.meterEnd !== null && e.meterEnd < e.meterStart) throw new OperationError('Horímetro final menor que o inicial.')
    if (!Number.isInteger(e.dieselCl) || e.dieselCl < 0) throw new OperationError('Litros de diesel inválidos.')
    if (e.hoursTenths !== null && (!Number.isInteger(e.hoursTenths) || e.hoursTenths < 0)) throw new OperationError('Horas trabalhadas inválidas.')
  }
  for (const c of input.otherCosts) {
    if (!c.description.trim()) throw new OperationError('Descreva cada custo adicional (ex.: diária do tratorista).')
    if (!Number.isInteger(c.costCents) || c.costCents <= 0) throw new OperationError('Informe o valor de cada custo adicional.')
  }
  if (input.type === 'herbicida' && input.products.length === 0) throw new OperationError('Informe o herbicida usado (um ou mais).')
  if (needsSeeds(input.type) && input.products.length === 0) throw new OperationError('Informe as sementes usadas (uma ou mais variedades).')
}

/** Cancela (estorna os consumos ligados e devolve estoque/diesel). Fica no histórico com o motivo. */
async function cancelInside(db: ArgoDatabase, op: FieldOperation, reason: string) {
  for (const p of op.products) await reverseSupplyMovement(db, p.movementId, reason, true)
  for (const e of op.equipments) if (e.fuelMovementId) await reverseFuelMovement(db, e.fuelMovementId, reason, true)
  await new Repository(db, 'fieldOperations').update(op.id, { status: 'cancelada', canceledAt: nowIso(), cancelReason: reason })
}

/**
 * Registra a operação. Com `replacesId` (correção), cancela a anterior e grava a nova na mesma transação.
 * Estoque ou diesel insuficiente → erro de estoque negativo (salvo com autorização).
 */
export async function createOperation(
  db: ArgoDatabase,
  farmId: string,
  input: OperationInput,
  key?: string,
  opts: { authorize?: { reason: string }; replacesId?: string; correctionReason?: string } = {},
): Promise<FieldOperation> {
  validate(input)
  const opId = key ?? newId()
  return db.transaction('rw', TABLES(db), async () => {
    const existing = await db.fieldOperations.get(opId)
    if (existing) return existing
    const pasture = await db.pastures.get(input.pastureId)
    if (!pasture || pasture.farmId !== farmId || pasture.deletedAt !== null) throw new OperationError('Pasto não encontrado.')
    if (pasture.areaHa !== null && input.workedAreaCentiHa > Math.round(pasture.areaHa * 100))
      throw new OperationError(`A área trabalhada não pode passar da área do pasto (${formatHa(Math.round(pasture.areaHa * 100))}).`)
    if (input.responsibleId) {
      const r = await db.responsibles.get(input.responsibleId)
      if (!r || r.farmId !== farmId) throw new OperationError('Responsável não encontrado.')
    }

    const all = await db.fieldOperations.where('farmId').equals(farmId).toArray()
    let replaced: FieldOperation | undefined
    if (opts.replacesId) {
      replaced = all.find((o) => o.id === opts.replacesId)
      if (!replaced || replaced.status !== 'concluida') throw new OperationError('Só dá para corrigir uma operação concluída.')
      if (!opts.correctionReason?.trim()) throw new OperationError('Informe o motivo da correção.')
    }
    const number = all.reduce((m, o) => Math.max(m, o.number), 0) + 1
    const tag = `Operação nº ${String(number).padStart(4, '0')} · ${typeLabel(input.type)}`
    if (replaced) await cancelInside(db, replaced, `Corrigida pela operação nº ${String(number).padStart(4, '0')}: ${opts.correctionReason!.trim()}`)

    // produtos → consumo no estoque de Insumos (custo médio do momento)
    const products: FieldOperationProduct[] = []
    for (const [i, line] of input.products.entries()) {
      const s = await db.supplies.get(line.supplyId)
      if (!s || s.farmId !== farmId || s.deletedAt !== null) throw new OperationError('Produto não encontrado.')
      if (needsSeeds(input.type) && categoryOf(s) !== 'semente') throw new OperationError(`${s.name} não é semente. No plantio, use produtos da categoria Sementes.`)
      const unit = unitOf(s)
      const m = await recordSupplyMovement(
        db,
        farmId,
        { supplyId: s.id, type: 'consumo', date: input.date, halves: unit === 'saco' ? line.qty : undefined, qty: unit === 'saco' ? undefined : line.qty, pastureId: pasture.id, operationId: opId, lot: line.lot, notes: tag },
        `${opId}-p${i + 1}`,
        opts.authorize,
      )
      products.push({
        supplyId: s.id,
        name: s.name,
        category: categoryOf(s),
        unit,
        qty: line.qty,
        costCents: m.costCents ?? 0,
        species: s.species || undefined,
        cultivar: s.cultivar || undefined,
        lot: (line.lot ?? '').trim() || undefined,
        movementId: m.id,
      })
    }

    // equipamentos → diesel: UM consumo no Diesel por equipamento (sem segunda baixa)
    const equipments: FieldOperationEquipment[] = []
    for (const [i, line] of input.equipments.entries()) {
      const eq = await db.equipments.get(line.equipmentId)
      if (!eq || eq.farmId !== farmId || eq.deletedAt !== null) throw new OperationError('Equipamento não encontrado.')
      let fuelMovementId: string | null = null
      let dieselCents = 0
      if (line.dieselCl > 0) {
        dieselCents = dieselCost(await db.fuelMovements.where('farmId').equals(farmId).toArray(), input.date, line.dieselCl)
        const f = await recordFuelMovement(
          db,
          farmId,
          {
            type: 'consumo',
            date: input.date,
            centiliters: line.dieselCl,
            equipmentId: eq.id,
            responsibleId: line.responsibleId ?? eq.responsibleId,
            meterReading: eq.meter !== 'nenhum' ? line.meterEnd : null,
            operationId: opId,
            pastureId: pasture.id,
            notes: `${tag} · ${pasture.name}`,
            // correção: a leitura pode ser anterior a outras já lançadas depois no mesmo equipamento
            skipMeterCheck: Boolean(replaced),
          },
          `${opId}-e${i + 1}`,
          opts.authorize,
        )
        fuelMovementId = f.id
      }
      const hoursTenths = workedHours(line)
      equipments.push({ equipmentId: eq.id, name: eq.name, responsibleId: line.responsibleId ?? eq.responsibleId, meterStart: line.meterStart, meterEnd: line.meterEnd, hoursTenths, dieselCl: line.dieselCl, dieselCents, fuelMovementId })
    }

    const seedsCents = products.filter((p) => p.category === 'semente').reduce((a, p) => a + p.costCents, 0)
    const productsCents = products.filter((p) => p.category !== 'semente').reduce((a, p) => a + p.costCents, 0)
    const dieselCents = equipments.reduce((a, e) => a + e.dieselCents, 0)
    const otherCosts = input.otherCosts.map((c) => ({ description: c.description.trim().slice(0, 80), costCents: c.costCents }))
    const otherCents = otherCosts.reduce((a, c) => a + c.costCents, 0)
    const op = await new Repository(db, 'fieldOperations').create(
      {
        farmId,
        number,
        type: input.type,
        date: input.date,
        pastureId: pasture.id,
        pastureAreaCentiHa: pasture.areaHa === null ? null : Math.round(pasture.areaHa * 100),
        workedAreaCentiHa: input.workedAreaCentiHa,
        responsibleId: input.responsibleId || null,
        products,
        equipments,
        otherCosts,
        productsCents,
        seedsCents,
        dieselCents,
        otherCents,
        totalCents: productsCents + seedsCents + dieselCents + otherCents,
        notes: input.notes.trim().slice(0, 1000),
        status: 'concluida',
        canceledAt: null,
        cancelReason: '',
        replacesId: replaced?.id ?? null,
        replacedById: null,
      },
      opId,
    )
    if (replaced) await new Repository(db, 'fieldOperations').update(replaced.id, { replacedById: op.id })
    return op
  })
}

/** Cancela uma operação concluída (com motivo). Devolve produtos e diesel ao estoque; nada é apagado. */
export async function cancelOperation(db: ArgoDatabase, id: string, reason: string): Promise<FieldOperation> {
  if (!reason.trim()) throw new OperationError('Informe o motivo do cancelamento.')
  return db.transaction('rw', TABLES(db), async () => {
    const op = await db.fieldOperations.get(id)
    if (!op) throw new OperationError('Operação não encontrada.')
    if (op.status !== 'concluida') throw new OperationError('Esta operação já foi cancelada.')
    await cancelInside(db, op, reason.trim())
    return (await db.fieldOperations.get(id))!
  })
}

/** Texto curto dos produtos usados (ex.: "Tordon 4 L + Garlon 1,5 L"). */
export function productsText(op: Pick<FieldOperation, 'products'>): string {
  return op.products.map((p) => `${p.name} ${formatQty(p.qty, p.unit)}`).join(' + ')
}

export const dieselText = (op: Pick<FieldOperation, 'equipments'>) => formatLiters(op.equipments.reduce((a, e) => a + e.dieselCl, 0))

/** Espécie/variedade atual do pasto: sementes do plantio/replantio mais recente (não cancelado). */
export function currentGrass(ops: readonly FieldOperation[], pastureId: string): { date: string; text: string } | null {
  const last = ops
    .filter((o) => o.pastureId === pastureId && o.status === 'concluida' && isFormation(o.type))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0]
  if (!last) return null
  const names = [...new Set(last.products.filter((p) => p.category === 'semente').map((p) => [p.species, p.cultivar].filter(Boolean).join(' ') || p.name))]
  return { date: last.date, text: names.join(' + ') }
}

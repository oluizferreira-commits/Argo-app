/**
 * Indicadores e relatórios do manejo de pastagens. Tudo vem das operações concluídas (custos guardados
 * nelas) e dos estoques (compras e saldo). Canceladas não entram.
 */
import type { FieldOperation, FieldOperationType, Pasture, Supply, SupplyMovement } from '../../db/types'
import { categoryOf, movQty, supplyLedger, supplyStock, unitOf } from '../insumos/supplies'
import { isFormation } from './operations'

export interface ManejoFilter {
  start: string | null
  end: string | null
  pastureId: string
  type: FieldOperationType | ''
  equipmentId: string
  supplyId: string
  /** "espécie|cultivar" */
  grass: string
}

export const EMPTY_FILTER: ManejoFilter = { start: null, end: null, pastureId: '', type: '', equipmentId: '', supplyId: '', grass: '' }

export const grassKey = (species?: string, cultivar?: string) => `${species ?? ''}|${cultivar ?? ''}`
export const grassLabel = (key: string) => key.split('|').filter(Boolean).join(' ') || 'Sem espécie'

export function filterOperations(ops: readonly FieldOperation[], f: ManejoFilter): FieldOperation[] {
  return ops.filter(
    (o) =>
      o.status === 'concluida' &&
      o.deletedAt === null &&
      (!f.start || o.date >= f.start) &&
      (!f.end || o.date <= f.end) &&
      (!f.pastureId || o.pastureId === f.pastureId) &&
      (!f.type || o.type === f.type) &&
      (!f.equipmentId || o.equipments.some((e) => e.equipmentId === f.equipmentId)) &&
      (!f.supplyId || o.products.some((p) => p.supplyId === f.supplyId)) &&
      (!f.grass || o.products.some((p) => p.category === 'semente' && grassKey(p.species, p.cultivar) === f.grass)),
  )
}

interface Agg {
  qty: number
  cents: number
}
const add = (m: Map<string, Agg>, k: string, qty: number, cents: number) => {
  const a = m.get(k) ?? { qty: 0, cents: 0 }
  a.qty += qty
  a.cents += cents
  m.set(k, a)
}

export interface PastureCost {
  pastureId: string
  name: string
  areaCentiHa: number | null
  herbicideCents: number
  seedsCents: number
  dieselCents: number
  otherCents: number
  totalCents: number
  /** plantio + replantio */
  formationCents: number
  /** custo total ÷ área do pasto (null sem área) */
  perHaCents: number | null
  operations: number
}

export function manejoStats(ops: readonly FieldOperation[], supplies: readonly Supply[], movements: readonly SupplyMovement[], pastures: readonly Pasture[], today: string, f: ManejoFilter = EMPTY_FILTER) {
  const list = filterOperations(ops, f)
  const month = today.slice(0, 7)
  const herbBy = new Map<string, Agg>()
  const seedBy = new Map<string, Agg>()
  const equipBy = new Map<string, { name: string; hours: number; cl: number; cents: number; ops: number }>()
  let herbCents = 0
  let herbMonth = 0
  let seedKgUsed = 0
  let plantedCentiHa = 0
  let dieselCl = 0
  let dieselCents = 0
  let hours = 0
  let workedCentiHa = 0
  for (const o of list) {
    workedCentiHa += o.workedAreaCentiHa
    if (isFormation(o.type)) plantedCentiHa += o.workedAreaCentiHa
    for (const p of o.products) {
      if (p.category === 'semente') {
        add(seedBy, grassKey(p.species, p.cultivar), p.qty, p.costCents)
        if (p.unit === 'kg') seedKgUsed += p.qty
      } else {
        add(herbBy, p.supplyId, p.qty, p.costCents)
        if (p.category === 'herbicida') {
          herbCents += p.costCents
          if (o.date.startsWith(month)) herbMonth += p.costCents
        }
      }
    }
    for (const e of o.equipments) {
      const g = equipBy.get(e.equipmentId) ?? { name: e.name, hours: 0, cl: 0, cents: 0, ops: 0 }
      g.hours += e.hoursTenths ?? 0
      g.cl += e.dieselCl
      g.cents += e.dieselCents
      g.ops++
      equipBy.set(e.equipmentId, g)
      hours += e.hoursTenths ?? 0
      dieselCl += e.dieselCl
      dieselCents += e.dieselCents
    }
  }

  // estoques (posição atual) e compras de sementes no período
  const inPeriod = (d: string) => (!f.start || d >= f.start) && (!f.end || d <= f.end)
  const live = supplies.filter((s) => s.deletedAt === null)
  const herbStock = live
    .filter((s) => categoryOf(s) === 'herbicida')
    .map((s) => ({ supply: s, qty: supplyStock(movements, s.id), valueCents: supplyLedger(movements, s.id).valueCents }))
  const seedStock = live
    .filter((s) => categoryOf(s) === 'semente')
    .map((s) => ({ supply: s, qty: supplyStock(movements, s.id), valueCents: supplyLedger(movements, s.id).valueCents }))
  const seedIds = new Set(seedStock.map((x) => x.supply.id))
  const seedBought = movements.filter((m) => seedIds.has(m.supplyId) && m.type === 'compra' && m.status === 'ativo' && m.deletedAt === null && inPeriod(m.date))
  const seedKgBought = seedBought.filter((m) => unitOf(live.find((s) => s.id === m.supplyId) ?? {}) === 'kg').reduce((a, m) => a + movQty(m), 0)
  const seedBoughtCents = seedBought.reduce((a, m) => a + (m.costCents ?? 0), 0)

  // custo por pasto
  const byPasture = new Map<string, PastureCost>()
  for (const o of list) {
    const p = pastures.find((x) => x.id === o.pastureId)
    const c =
      byPasture.get(o.pastureId) ??
      ({ pastureId: o.pastureId, name: p?.name ?? 'pasto removido', areaCentiHa: p?.areaHa == null ? null : Math.round(p.areaHa * 100), herbicideCents: 0, seedsCents: 0, dieselCents: 0, otherCents: 0, totalCents: 0, formationCents: 0, perHaCents: null, operations: 0 } as PastureCost)
    c.herbicideCents += o.productsCents
    c.seedsCents += o.seedsCents
    c.dieselCents += o.dieselCents
    c.otherCents += o.otherCents
    c.totalCents += o.totalCents
    if (isFormation(o.type)) c.formationCents += o.totalCents
    c.operations++
    byPasture.set(o.pastureId, c)
  }
  for (const c of byPasture.values()) c.perHaCents = c.areaCentiHa ? Math.round((c.totalCents * 100) / c.areaCentiHa) : null

  return {
    operations: list,
    herbicides: {
      totalCents: herbCents,
      monthCents: herbMonth,
      byProduct: [...herbBy.entries()].map(([id, a]) => ({ supply: live.find((s) => s.id === id) ?? supplies.find((s) => s.id === id), ...a })).sort((a, b) => b.cents - a.cents),
      stock: herbStock,
      stockValueCents: herbStock.reduce((a, x) => a + x.valueCents, 0),
    },
    seeds: {
      stock: seedStock,
      stockValueCents: seedStock.reduce((a, x) => a + x.valueCents, 0),
      kgBought: seedKgBought,
      boughtCents: seedBoughtCents,
      kgUsed: seedKgUsed,
      plantedCentiHa,
      byGrass: [...seedBy.entries()].map(([k, a]) => ({ key: k, ...a })).sort((a, b) => b.cents - a.cents),
    },
    machines: {
      operations: list.length,
      dieselCl,
      dieselCents,
      hoursTenths: hours,
      workedCentiHa,
      byEquipment: [...equipBy.entries()].map(([id, g]) => ({ equipmentId: id, ...g })).sort((a, b) => b.cents - a.cents || b.hours - a.hours),
    },
    pastures: [...byPasture.values()].sort((a, b) => b.totalCents - a.totalCents),
    totalCents: list.reduce((a, o) => a + o.totalCents, 0),
  }
}
export type ManejoStats = ReturnType<typeof manejoStats>

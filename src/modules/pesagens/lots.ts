/**
 * Pesagem de lote: pesar primeiro (no curral, sem comprador nem preço) e vender depois.
 * Cada lançamento é gravado na hora (não se perde se o app fechar). Os animais só saem do rebanho
 * quando o lote é vendido, pela venda por kg.
 */
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { KgWeighing, LotWeighing, SaleItem, WeighingLot } from '../../db/types'
import { newId, nowIso } from '../../core/ids'
import { todayLocal } from '../rebanho/herd'

export class LotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LotError'
  }
}

const TABLES = (db: ArgoDatabase) => [db.weighingLots, db.auditLog, db.outbox, db.meta]

export async function createLot(db: ArgoDatabase, farmId: string, name = '', key?: string): Promise<WeighingLot> {
  return new Repository(db, 'weighingLots').create(
    { farmId, date: todayLocal(), name: name.trim().slice(0, 60), notes: '', weighings: [], status: 'aberta', saleId: null },
    key,
  )
}

async function openLot(db: ArgoDatabase, id: string): Promise<WeighingLot> {
  const lot = await db.weighingLots.get(id)
  if (!lot || lot.deletedAt !== null) throw new LotError('Pesagem não encontrada.')
  if (lot.status !== 'aberta') throw new LotError(lot.status === 'vendida' ? 'Este lote já foi vendido.' : 'Esta pesagem foi cancelada.')
  return lot
}

/** Máximo de cabeças por subida na balança. */
export const MAX_HEADS_PER_WEIGHING = 4

export function validateWeighing(heads: number, kgTenths: number) {
  if (!Number.isInteger(heads) || heads < 1 || heads > MAX_HEADS_PER_WEIGHING) throw new LotError(`Cada pesagem deve ter de 1 a ${MAX_HEADS_PER_WEIGHING} cabeças.`)
  if (!Number.isInteger(kgTenths) || kgTenths <= 0) throw new LotError('Digite o peso da balança.')
  if (kgTenths < 200 * heads || kgTenths > 15000 * heads) throw new LotError(`Peso fora do normal para ${heads} cabeça(s). Confira.`)
}

/** Lança uma subida na balança: só quantas cabeças (1 a 4, podem ser misturadas) e o peso. */
export async function addWeighing(db: ArgoDatabase, lotId: string, w: KgWeighing): Promise<WeighingLot> {
  validateWeighing(w.heads, w.kgTenths)
  return db.transaction('rw', TABLES(db), async () => {
    const lot = await openLot(db, lotId)
    const line: LotWeighing = { id: newId(), heads: w.heads, kgTenths: w.kgTenths, at: nowIso() }
    return new Repository(db, 'weighingLots').update(lotId, { weighings: [...lot.weighings, line] })
  })
}

/**
 * O que tem no lote (cabeças por pasto e categoria). Informado uma vez — antes, durante ou depois de pesar —,
 * porque na balança os animais sobem misturados.
 */
export async function setComposition(db: ArgoDatabase, lotId: string, items: readonly SaleItem[]): Promise<WeighingLot> {
  const clean = items.filter((i) => i.quantity > 0)
  if (clean.some((i) => !Number.isInteger(i.quantity) || !i.pastureId)) throw new LotError('Quantidades inválidas.')
  return db.transaction('rw', TABLES(db), async () => {
    await openLot(db, lotId)
    return new Repository(db, 'weighingLots').update(lotId, { composition: clean.map((i) => ({ pastureId: i.pastureId, category: i.category, quantity: i.quantity })) })
  })
}

export async function removeWeighing(db: ArgoDatabase, lotId: string, weighingId: string): Promise<WeighingLot> {
  return db.transaction('rw', TABLES(db), async () => {
    const lot = await openLot(db, lotId)
    return new Repository(db, 'weighingLots').update(lotId, { weighings: lot.weighings.filter((x) => x.id !== weighingId) })
  })
}

export async function renameLot(db: ArgoDatabase, lotId: string, name: string, notes: string): Promise<WeighingLot> {
  return new Repository(db, 'weighingLots').update(lotId, { name: name.trim().slice(0, 60), notes: notes.trim().slice(0, 300) })
}

export async function cancelLot(db: ArgoDatabase, lotId: string): Promise<WeighingLot> {
  return db.transaction('rw', TABLES(db), async () => {
    await openLot(db, lotId)
    return new Repository(db, 'weighingLots').update(lotId, { status: 'cancelada' })
  })
}

export interface LotSummary {
  heads: number
  kgTenths: number
  /** kg × 10 por cabeça (média) */
  avgTenths: number
  /** animais por pasto e categoria (para a venda) */
  items: SaleItem[]
}

export function lotSummary(lot: Pick<WeighingLot, 'weighings' | 'composition'>): LotSummary {
  let heads = 0
  let kg = 0
  for (const w of lot.weighings) {
    heads += w.heads
    kg += w.kgTenths
  }
  return { heads, kgTenths: kg, avgTenths: heads ? Math.round(kg / heads) : 0, items: compositionOf(lot) }
}

/** Composição do lote; lotes da versão 0.27.0 (pesagem com pasto/categoria) são convertidos. */
export function compositionOf(lot: Pick<WeighingLot, 'weighings' | 'composition'>): SaleItem[] {
  if (lot.composition) return lot.composition
  const map = new Map<string, SaleItem>()
  for (const w of lot.weighings) {
    if (!w.pastureId || !w.category) continue
    const k = `${w.pastureId}|${w.category}`
    const it = map.get(k) ?? { pastureId: w.pastureId, category: w.category, quantity: 0 }
    it.quantity += w.heads
    map.set(k, it)
  }
  return [...map.values()]
}

export const compositionHeads = (items: readonly SaleItem[]) => items.reduce((a, i) => a + i.quantity, 0)

/** Mesmas pesagens? (a venda tem de usar exatamente o que foi pesado no lote) */
export function sameWeighings(lot: Pick<WeighingLot, 'weighings'>, weighings: readonly KgWeighing[]): boolean {
  const a = lot.weighings.map((w) => `${w.heads}|${w.kgTenths}`).sort()
  const b = weighings.map((w) => `${w.heads}|${w.kgTenths}`).sort()
  return a.length === b.length && a.every((x, i) => x === b[i])
}

export interface WeightGroup {
  weighings: number
  heads: number
  kgTenths: number
  /** média por cabeça, kg × 10 (0 se vazio) */
  avgTenths: number
}

/**
 * Separa as pesagens pelo peso de corte (kg × 10 por cabeça): "acima" = média por cabeça da pesagem igual ou
 * maior que o corte; "abaixo" = menor. Cada pesagem conta inteira no grupo (os animais subiram juntos).
 */
export function splitByWeight(weighings: readonly KgWeighing[], cutTenths: number): { above: WeightGroup; below: WeightGroup } {
  const g = (): WeightGroup => ({ weighings: 0, heads: 0, kgTenths: 0, avgTenths: 0 })
  const above = g()
  const below = g()
  for (const w of weighings) {
    const grp = w.kgTenths >= cutTenths * w.heads ? above : below
    grp.weighings++
    grp.heads += w.heads
    grp.kgTenths += w.kgTenths
  }
  for (const grp of [above, below]) grp.avgTenths = grp.heads ? Math.round(grp.kgTenths / grp.heads) : 0
  return { above, below }
}

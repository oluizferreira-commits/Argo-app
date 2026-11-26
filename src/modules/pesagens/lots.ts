/**
 * Pesagem de lote: pesar primeiro (no curral, sem comprador nem preço) e vender depois.
 * Cada lançamento é gravado na hora (não se perde se o app fechar). Os animais só saem do rebanho
 * quando o lote é vendido, pela venda por kg.
 */
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { LotWeighing, SaleItem, WeighingLot } from '../../db/types'
import type { CategoryId } from '../../domain/categories'
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

export function validateWeighing(heads: number, kgTenths: number) {
  if (!Number.isInteger(heads) || heads < 1 || heads > 3) throw new LotError('Cada pesagem deve ter de 1 a 3 cabeças.')
  if (!Number.isInteger(kgTenths) || kgTenths <= 0) throw new LotError('Digite o peso da balança.')
  if (kgTenths < 200 * heads || kgTenths > 15000 * heads) throw new LotError(`Peso fora do normal para ${heads} cabeça(s). Confira.`)
}

export async function addWeighing(db: ArgoDatabase, lotId: string, w: { pastureId: string; category: CategoryId; heads: number; kgTenths: number }): Promise<WeighingLot> {
  validateWeighing(w.heads, w.kgTenths)
  return db.transaction('rw', TABLES(db), async () => {
    const lot = await openLot(db, lotId)
    const line: LotWeighing = { id: newId(), pastureId: w.pastureId, category: w.category, heads: w.heads, kgTenths: w.kgTenths, at: nowIso() }
    return new Repository(db, 'weighingLots').update(lotId, { weighings: [...lot.weighings, line] })
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

export function lotSummary(lot: Pick<WeighingLot, 'weighings'>): LotSummary {
  const map = new Map<string, SaleItem>()
  let heads = 0
  let kg = 0
  for (const w of lot.weighings) {
    heads += w.heads
    kg += w.kgTenths
    const k = `${w.pastureId}|${w.category}`
    const it = map.get(k) ?? { pastureId: w.pastureId, category: w.category, quantity: 0 }
    it.quantity += w.heads
    map.set(k, it)
  }
  return { heads, kgTenths: kg, avgTenths: heads ? Math.round(kg / heads) : 0, items: [...map.values()] }
}

/** Mesmas pesagens? (a venda tem de usar exatamente o que foi pesado no lote) */
export function sameWeighings(lot: Pick<WeighingLot, 'weighings'>, animals: readonly { pastureId: string; category: CategoryId; amount: number; heads?: number }[]): boolean {
  const a = lot.weighings.map((w) => `${w.pastureId}|${w.category}|${w.heads}|${w.kgTenths}`).sort()
  const b = animals.map((w) => `${w.pastureId}|${w.category}|${w.heads ?? 1}|${w.amount}`).sort()
  return a.length === b.length && a.every((x, i) => x === b[i])
}

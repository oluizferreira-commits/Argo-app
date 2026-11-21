import { nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Payment, ReserveEntry, Sale } from '../../db/types'
import { todayLocal } from '../rebanho/herd'

/** Percentual da reserva financeira sobre cada venda. */
export const RESERVE_PERCENT = 35

export class ReserveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReserveError'
  }
}

/** Parte da reserva de um valor recebido (35%, arredondado ao centavo). */
export function reserveShare(amountCents: number): number {
  return Math.round((amountCents * RESERVE_PERCENT) / 100)
}

export interface ReserveSummary {
  /** Meta: 35% do total das vendas ativas. */
  targetCents: number
  /** Devido: 35% de tudo o que já foi recebido (recebimentos ativos). */
  dueCents: number
  /** Total transferido para a reserva (depósitos ativos). */
  depositedCents: number
  /** Total retirado da reserva (retiradas ativas). */
  withdrawnCents: number
  /** Saldo da conta da reserva = depósitos − retiradas. */
  balanceCents: number
  /** Falta separar = devido − depositado (0 se já transferiu tudo). */
  pendingCents: number
  /** Transferido a mais que o devido (ex.: recebimento estornado depois do depósito). */
  surplusCents: number
}

const active = (e: { status: string; deletedAt: string | null }) => e.status === 'ativo' && e.deletedAt === null

export function reserveSummary(sales: readonly Sale[], payments: readonly Payment[], entries: readonly ReserveEntry[]): ReserveSummary {
  const targetCents = sales.filter((s) => s.status === 'ativa').reduce((a, s) => a + reserveShare(s.totalCents), 0)
  const dueCents = payments.filter(active).reduce((a, p) => a + reserveShare(p.amountCents), 0)
  const depositedCents = entries.filter((e) => active(e) && e.type === 'deposito').reduce((a, e) => a + e.amountCents, 0)
  const withdrawnCents = entries.filter((e) => active(e) && e.type === 'retirada').reduce((a, e) => a + e.amountCents, 0)
  return {
    targetCents,
    dueCents,
    depositedCents,
    withdrawnCents,
    balanceCents: depositedCents - withdrawnCents,
    pendingCents: Math.max(0, dueCents - depositedCents),
    surplusCents: Math.max(0, depositedCents - dueCents),
  }
}

/**
 * Quanto falta separar de cada recebimento. Depósitos ligados a um recebimento abatem o dele;
 * depósitos avulsos (e o que sobrar) abatem os recebimentos pendentes do mais antigo para o mais novo.
 * A soma sempre bate com `reserveSummary().pendingCents`.
 */
export function reservePendingByPayment(payments: readonly Payment[], entries: readonly ReserveEntry[]): Map<string, number> {
  const list = payments.filter(active).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  const deposits = entries.filter((e) => active(e) && e.type === 'deposito')
  const linked = new Map<string, number>()
  let pool = 0
  const ids = new Set(list.map((p) => p.id))
  for (const d of deposits) {
    if (d.paymentId && ids.has(d.paymentId)) linked.set(d.paymentId, (linked.get(d.paymentId) ?? 0) + d.amountCents)
    else pool += d.amountCents
  }
  const remaining = new Map<string, number>()
  for (const p of list) {
    const due = reserveShare(p.amountCents)
    const l = linked.get(p.id) ?? 0
    if (l > due) pool += l - due
    remaining.set(p.id, Math.max(0, due - l))
  }
  for (const p of list) {
    const r = remaining.get(p.id)!
    const take = Math.min(pool, r)
    remaining.set(p.id, r - take)
    pool -= take
  }
  return remaining
}

/** Quanto ainda falta separar referente a um recebimento. */
export function pendingForPayment(payment: Payment, entries: readonly ReserveEntry[], allPayments: readonly Payment[] = [payment]): number {
  return reservePendingByPayment(allPayments, entries).get(payment.id) ?? 0
}

export interface ReserveInput {
  type: 'deposito' | 'retirada'
  date: string
  amountCents: number
  notes: string
  paymentId?: string | null
}

async function balanceOf(db: ArgoDatabase, farmId: string): Promise<number> {
  const entries = await db.reserveEntries.where('farmId').equals(farmId).toArray()
  return entries.filter(active).reduce((a, e) => a + (e.type === 'deposito' ? e.amountCents : -e.amountCents), 0)
}

/** Registra depósito (transferência para a reserva) ou retirada. */
export async function recordReserveEntry(db: ArgoDatabase, farmId: string, input: ReserveInput, idempotencyKey?: string): Promise<ReserveEntry> {
  const repo = new Repository(db, 'reserveEntries')
  return db.transaction('rw', [db.reserveEntries, db.payments, db.auditLog, db.outbox, db.meta], async () => {
    if (idempotencyKey) {
      const existing = await db.reserveEntries.get(idempotencyKey)
      if (existing) return existing
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ReserveError('Informe a data.')
    if (input.date > todayLocal()) throw new ReserveError('A data não pode ser no futuro.')
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new ReserveError('Informe o valor.')
    const notes = input.notes.trim()
    if (input.type === 'retirada') {
      if (!notes) throw new ReserveError('Informe o motivo da retirada.')
      const balance = await balanceOf(db, farmId)
      if (input.amountCents > balance)
        throw new ReserveError(`Saldo insuficiente na reserva (R$ ${(balance / 100).toFixed(2).replace('.', ',')}).`)
    }
    if (input.paymentId) {
      const p = await db.payments.get(input.paymentId)
      if (!p || p.farmId !== farmId) throw new ReserveError('Recebimento não encontrado.')
    }
    return repo.create(
      {
        farmId,
        type: input.type,
        date: input.date,
        amountCents: input.amountCents,
        paymentId: input.type === 'deposito' ? (input.paymentId ?? null) : null,
        notes,
        status: 'ativo',
        reversedAt: null,
        reverseReason: '',
      },
      idempotencyKey,
    )
  })
}

/** Estorna um lançamento da reserva. Não deixa o saldo ficar negativo. */
export async function reverseReserveEntry(db: ArgoDatabase, id: string, reason: string): Promise<ReserveEntry> {
  const repo = new Repository(db, 'reserveEntries')
  return db.transaction('rw', [db.reserveEntries, db.auditLog, db.outbox, db.meta], async () => {
    const e = await db.reserveEntries.get(id)
    if (!e) throw new ReserveError('Lançamento não encontrado.')
    if (e.status === 'estornado') throw new ReserveError('Este lançamento já foi estornado.')
    if (e.type === 'deposito' && (await balanceOf(db, e.farmId)) - e.amountCents < 0)
      throw new ReserveError('Não é possível estornar: o saldo da reserva ficaria negativo (já houve retiradas).')
    return repo.update(id, { status: 'estornado', reversedAt: nowIso(), reverseReason: reason.trim() })
  })
}

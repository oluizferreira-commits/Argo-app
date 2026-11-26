import { nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Farm, Payment, ReserveCheck, ReserveEntry, Sale } from '../../db/types'
import { todayLocal } from '../rebanho/herd'

/** Percentual padrão da reserva (até o responsável definir outro). */
export const DEFAULT_RESERVE_PERCENT = 35

type RateFarm = Pick<Farm, 'reserveRates'> | null | undefined

/** Histórico de percentuais da fazenda, do mais antigo ao mais novo. */
export function reserveRates(farm: RateFarm): { since: string; percent: number }[] {
  return [...(farm?.reserveRates ?? [])].sort((a, b) => a.since.localeCompare(b.since))
}

/** Percentual vigente numa data (o último definido até aquela data; antes disso, 35%). */
export function rateOn(farm: RateFarm, date: string): number {
  let p = DEFAULT_RESERVE_PERCENT
  for (const r of reserveRates(farm)) if (r.since <= date) p = r.percent
  return p
}

export function currentRate(farm: RateFarm): number {
  return rateOn(farm, todayLocal())
}

export function formatPercent(p: number): string {
  return `${p.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}

/**
 * Define o percentual da reserva a partir de uma data. Recebimentos anteriores mantêm o percentual
 * da época. Fica no histórico (auditoria) da fazenda.
 */
export async function setReserveRate(db: ArgoDatabase, farm: Farm, percent: number, since: string): Promise<Farm> {
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new ReserveError('O percentual deve ser maior que 0 e no máximo 100.')
  if (Math.round(percent * 100) !== percent * 100) throw new ReserveError('Use no máximo duas casas decimais (ex.: 32,5).')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new ReserveError('Informe a data a partir da qual vale.')
  if (since > todayLocal()) throw new ReserveError('A data não pode ser no futuro.')
  const rates = reserveRates(farm).filter((r) => r.since !== since)
  return new Repository(db, 'farms').update(farm.id, { reserveRates: [...rates, { since, percent }].sort((a, b) => a.since.localeCompare(b.since)) })
}

export class ReserveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReserveError'
  }
}

/** Parte da reserva de um valor (percentual informado; padrão 35%), arredondada ao centavo. */
export function reserveShare(amountCents: number, percent = DEFAULT_RESERVE_PERCENT): number {
  return Math.round((amountCents * Math.round(percent * 100)) / 10000)
}

/**
 * Só as vendas para GASTOS PESSOAIS entram na reserva. O dinheiro da venda para a fazenda fica na fazenda
 * (diesel, sal etc.) e não gera nada a separar.
 */
export const countsForReserve = (sale: Pick<Sale, 'purpose'> | undefined): boolean => sale?.purpose === 'pessoal'

/** Recebimentos que geram reserva (os de vendas para gastos pessoais). */
export function reservePayments(payments: readonly Payment[], sales: readonly Sale[]): Payment[] {
  const ids = new Set(sales.filter(countsForReserve).map((s) => s.id))
  return payments.filter((p) => ids.has(p.saleId))
}

export interface ReserveSummary {
  /** Meta: percentual da reserva sobre o total das vendas ativas. */
  targetCents: number
  /** Devido: percentual da reserva sobre tudo o que já foi recebido (recebimentos ativos). */
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

export function reserveSummary(
  sales: readonly Sale[],
  payments: readonly Payment[],
  entries: readonly ReserveEntry[],
  farm?: RateFarm,
): ReserveSummary {
  const targetCents = sales.filter((s) => s.status === 'ativa' && countsForReserve(s)).reduce((a, s) => a + reserveShare(s.totalCents, rateOn(farm, s.date)), 0)
  const dueCents = reservePayments(payments, sales).filter(active).reduce((a, p) => a + reserveShare(p.amountCents, rateOn(farm, p.date)), 0)
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
export function reservePendingByPayment(payments: readonly Payment[], entries: readonly ReserveEntry[], farm?: RateFarm): Map<string, number> {
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
    const due = reserveShare(p.amountCents, rateOn(farm, p.date))
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
export function pendingForPayment(
  payment: Payment,
  entries: readonly ReserveEntry[],
  allPayments: readonly Payment[] = [payment],
  farm?: RateFarm,
): number {
  return reservePendingByPayment(allPayments, entries, farm).get(payment.id) ?? 0
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

// ------------------------------------------------------------------ conferência de saldo

export const DEFAULT_ACCOUNT = 'Mercado Pago'
/** Depois de tantos dias sem conferir, a tela lembra de conferir o saldo. */
export const CHECK_REMINDER_DAYS = 30

/** Registra a conferência: saldo visto no banco × saldo calculado pelo ARGO agora. */
export async function recordReserveCheck(
  db: ArgoDatabase,
  farmId: string,
  input: { informedCents: number; date: string; account?: string; notes?: string },
  idempotencyKey?: string,
): Promise<ReserveCheck> {
  if (!Number.isInteger(input.informedCents) || input.informedCents < 0) throw new ReserveError('Informe o saldo que aparece no banco.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date > todayLocal()) throw new ReserveError('Data inválida.')
  const repo = new Repository(db, 'reserveChecks')
  return db.transaction('rw', [db.reserveChecks, db.reserveEntries, db.auditLog, db.outbox, db.meta], async () => {
    if (idempotencyKey) {
      const existing = await db.reserveChecks.get(idempotencyKey)
      if (existing) return existing
    }
    const systemCents = await balanceOf(db, farmId)
    return repo.create(
      {
        farmId,
        account: (input.account ?? DEFAULT_ACCOUNT).trim() || DEFAULT_ACCOUNT,
        date: input.date,
        informedCents: input.informedCents,
        systemCents,
        differenceCents: input.informedCents - systemCents,
        notes: (input.notes ?? '').trim(),
      },
      idempotencyKey,
    )
  })
}

/**
 * Ajusta o ARGO para bater com o banco: diferença negativa vira retirada; positiva vira depósito.
 * O motivo é obrigatório (ex.: "Tarifa do banco", "Transferência esquecida").
 */
export async function adjustFromCheck(db: ArgoDatabase, check: ReserveCheck, reason: string): Promise<ReserveEntry> {
  const motivo = reason.trim()
  if (!motivo) throw new ReserveError('Informe o motivo do ajuste.')
  if (check.differenceCents === 0) throw new ReserveError('O saldo já confere.')
  return recordReserveEntry(
    db,
    check.farmId,
    {
      type: check.differenceCents < 0 ? 'retirada' : 'deposito',
      date: todayLocal(),
      amountCents: Math.abs(check.differenceCents),
      notes: `Ajuste da conferência (${check.account}): ${motivo}`,
    },
    `${check.id}-ajuste`,
  )
}

/** Dias desde a última conferência (null se nunca conferiu). */
export function daysSinceCheck(checks: readonly ReserveCheck[], today = todayLocal()): number | null {
  const last = checks.filter((c) => c.deletedAt === null).map((c) => c.date).sort().at(-1)
  if (!last) return null
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000)
}

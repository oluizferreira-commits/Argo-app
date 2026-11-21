import { nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Payment, PaymentMethod, Sale } from '../../db/types'
import { todayLocal } from '../rebanho/herd'

export class PaymentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentError'
  }
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
  cheque: 'Cheque',
  outro: 'Outro',
}

export type InstallmentStatus = 'paga' | 'parcial' | 'aberta' | 'vencida'

export const STATUS_LABEL: Record<InstallmentStatus, string> = { paga: 'Paga', parcial: 'Parcial', aberta: 'Em aberto', vencida: 'Vencida' }
export const STATUS_BADGE: Record<InstallmentStatus, string> = { paga: 'badge-ok', parcial: 'badge-gold', aberta: 'badge-neutral', vencida: 'badge-warn' }

export interface InstallmentState {
  index: number
  due: string
  amountCents: number
  paidCents: number
  openCents: number
  status: InstallmentStatus
}

export interface SaleBalance {
  totalCents: number
  paidCents: number
  openCents: number
  overdueCents: number
  installments: InstallmentState[]
  /** quitada = tudo pago */
  settled: boolean
}

/** Pagamentos ativos em ordem (data do recebimento, depois lançamento). */
export function activePayments(payments: readonly Payment[]): Payment[] {
  return payments
    .filter((p) => p.status === 'ativo' && p.deletedAt === null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
}

/**
 * Situação da venda: os recebimentos abatem as parcelas da mais antiga para a mais nova.
 * Calculado sempre a partir dos pagamentos (nada é sobrescrito).
 */
export function saleBalance(sale: Pick<Sale, 'totalCents' | 'installments'>, payments: readonly Payment[], today = todayLocal()): SaleBalance {
  let pool = activePayments(payments).reduce((a, p) => a + p.amountCents, 0)
  const installments: InstallmentState[] = sale.installments.map((inst, index) => {
    const paid = Math.min(pool, inst.amountCents)
    pool -= paid
    const open = inst.amountCents - paid
    const status: InstallmentStatus = open === 0 ? 'paga' : inst.due < today ? 'vencida' : paid > 0 ? 'parcial' : 'aberta'
    return { index, due: inst.due, amountCents: inst.amountCents, paidCents: paid, openCents: open, status }
  })
  const paidCents = installments.reduce((a, i) => a + i.paidCents, 0)
  return {
    totalCents: sale.totalCents,
    paidCents,
    openCents: sale.totalCents - paidCents,
    overdueCents: installments.filter((i) => i.status === 'vencida').reduce((a, i) => a + i.openCents, 0),
    installments,
    settled: paidCents >= sale.totalCents,
  }
}

export interface PaymentInput {
  saleId: string
  date: string
  amountCents: number
  method: PaymentMethod
  notes: string
}

function validate(input: PaymentInput, sale: Sale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new PaymentError('Informe a data do recebimento.')
  if (input.date > todayLocal()) throw new PaymentError('A data do recebimento não pode ser no futuro.')
  if (input.date < sale.date) throw new PaymentError('O recebimento não pode ser antes da data da venda.')
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new PaymentError('Informe o valor recebido.')
  if (!(input.method in METHOD_LABELS)) throw new PaymentError('Escolha a forma de pagamento.')
}

/**
 * Registra um recebimento (parcial ou total). Recusa valor acima do saldo em aberto.
 * Pode ser chamado dentro de outra transação (ex.: venda à vista já recebida).
 */
export async function recordPayment(db: ArgoDatabase, farmId: string, input: PaymentInput, idempotencyKey?: string): Promise<Payment> {
  const repo = new Repository(db, 'payments')
  return db.transaction('rw', [db.payments, db.sales, db.auditLog, db.outbox, db.meta], async () => {
    if (idempotencyKey) {
      const existing = await db.payments.get(idempotencyKey)
      if (existing) return existing
    }
    const sale = await db.sales.get(input.saleId)
    if (!sale || sale.farmId !== farmId) throw new PaymentError('Venda não encontrada.')
    if (sale.status !== 'ativa') throw new PaymentError('Esta venda foi cancelada.')
    validate(input, sale)
    const balance = saleBalance(sale, await db.payments.where('saleId').equals(sale.id).toArray())
    if (balance.openCents <= 0) throw new PaymentError('Esta venda já está quitada.')
    if (input.amountCents > balance.openCents)
      throw new PaymentError(`O valor é maior que o saldo em aberto (R$ ${(balance.openCents / 100).toFixed(2).replace('.', ',')}).`)
    return repo.create(
      {
        farmId,
        saleId: sale.id,
        clientId: sale.clientId,
        date: input.date,
        amountCents: input.amountCents,
        method: input.method,
        notes: input.notes.trim(),
        status: 'ativo',
        reversedAt: null,
        reverseReason: '',
      },
      idempotencyKey,
    )
  })
}

/** Estorna um recebimento lançado errado (continua no histórico). */
export async function reversePayment(db: ArgoDatabase, id: string, reason: string): Promise<Payment> {
  const repo = new Repository(db, 'payments')
  return db.transaction('rw', [db.payments, db.auditLog, db.outbox, db.meta], async () => {
    const p = await db.payments.get(id)
    if (!p) throw new PaymentError('Recebimento não encontrado.')
    if (p.status === 'estornado') throw new PaymentError('Este recebimento já foi estornado.')
    return repo.update(id, { status: 'estornado', reversedAt: nowIso(), reverseReason: reason.trim() })
  })
}

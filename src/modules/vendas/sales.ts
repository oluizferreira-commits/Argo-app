import { newId, nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import { sameWeighings } from '../pesagens/lots'
import type { Client, Installment, PaymentKind, PaymentMethod, Sale, SaleItem, SalePurpose, WeighedAnimal } from '../../db/types'
import { category, type CategoryId } from '../../domain/categories'
import { isValidCnpj, isValidCpf } from '../../domain/pix'
import { entriesOut, HerdError, recordMovement, reverseMovement, todayLocal } from '../rebanho/herd'
import { activePayments, PaymentError, recordPayment } from '../receber/receivables'

export class SaleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaleError'
  }
}

// ------------------------------------------------------------------ cálculos

/** Arredondamento comercial (meio para cima) de a / b, com inteiros. */
function roundDiv(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b))
}

export interface Totals {
  arrobasHundredths: number
  totalCents: number
}

/**
 * Peso vivo: arrobas = kg ÷ 30 (rendimento de 50% sobre @ de 15 kg).
 * Carcaça (abate): arrobas lançadas direto.
 * Por cabeça: quantidade × preço da categoria.
 */
export function computeTotals(s: Pick<Sale, 'mode' | 'weighing' | 'animals' | 'pricePerArrobaCents' | 'pricePerHeadCents' | 'items'> & { pricePerKgCents?: number | null }): Totals {
  if (s.mode === 'kg') {
    // amount = kg × 10 de cada pesagem; valor = kg × 10 × preço do kg / 10; arrobas só para informação (kg ÷ 30)
    const sum = s.animals.reduce((a, x) => a + x.amount, 0)
    return { arrobasHundredths: roundDiv(sum, 3), totalCents: roundDiv(sum * (s.pricePerKgCents ?? 0), 10) }
  }
  if (s.mode === 'arroba') {
    const sum = s.animals.reduce((a, x) => a + x.amount, 0)
    const price = s.pricePerArrobaCents ?? 0
    if (s.weighing === 'vivo') {
      // amount = kg × 10 → arrobas×100 = kg×10 / 3 ; valor = kg×10 × preço / 300
      return { arrobasHundredths: roundDiv(sum, 3), totalCents: roundDiv(sum * price, 300) }
    }
    return { arrobasHundredths: sum, totalCents: roundDiv(sum * price, 100) }
  }
  const total = s.items.reduce((a, it) => a + it.quantity * (s.pricePerHeadCents[it.category] ?? 0), 0)
  return { arrobasHundredths: 0, totalCents: total }
}

/** Agrupa os animais pesados em itens (pasto × categoria × quantidade). */
export function itemsFromAnimals(animals: readonly WeighedAnimal[]): SaleItem[] {
  const map = new Map<string, SaleItem>()
  for (const a of animals) {
    const k = `${a.pastureId}|${a.category}`
    const it = map.get(k) ?? { pastureId: a.pastureId, category: a.category, quantity: 0 }
    it.quantity += a.heads ?? 1
    map.set(k, it)
  }
  return [...map.values()]
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** Parcelas: divide em partes iguais; a diferença de centavos vai para a 1ª parcela. */
export function buildInstallments(
  kind: PaymentKind,
  saleDate: string,
  totalCents: number,
  opts: { days?: number; count?: number; intervalDays?: number; firstDue?: string } = {},
): Installment[] {
  if (kind === 'avista') return [{ due: saleDate, amountCents: totalCents }]
  if (kind === 'prazo') return [{ due: addDays(saleDate, opts.days ?? 30), amountCents: totalCents }]
  const n = opts.count ?? 2
  const interval = opts.intervalDays ?? 30
  const first = opts.firstDue ?? addDays(saleDate, interval)
  const base = Math.floor(totalCents / n)
  return Array.from({ length: n }, (_, i) => ({
    due: addDays(first, i * interval),
    amountCents: base + (i === 0 ? totalCents - base * n : 0),
  }))
}

// ------------------------------------------------------------------ clientes

export interface ClientInput {
  name: string
  phone: string
  city: string
  document: string
}

export const EMPTY_CLIENT: ClientInput = { name: '', phone: '', city: '', document: '' }

function cleanClient(input: ClientInput): ClientInput {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!name) throw new SaleError('Informe o nome do cliente.')
  if (name.length > 80) throw new SaleError('Nome muito longo.')
  const doc = input.document.replace(/\D/g, '')
  if (doc && !(doc.length === 11 ? isValidCpf(doc) : doc.length === 14 ? isValidCnpj(doc) : false))
    throw new SaleError('CPF/CNPJ do cliente inválido.')
  const phone = input.phone.trim()
  const phoneDigits = phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (phone && phoneDigits.length !== 10 && phoneDigits.length !== 11)
    throw new SaleError('Telefone do cliente deve ter DDD + número, ex.: (34) 99999-1234.')
  return { name, phone, city: input.city.trim(), document: doc }
}

export async function createClient(db: ArgoDatabase, farmId: string, input: ClientInput, idempotencyKey?: string): Promise<Client> {
  const data = cleanClient(input)
  const repo = new Repository(db, 'clients')
  return db.transaction('rw', [db.clients, db.auditLog, db.outbox, db.meta], async () => {
    if (idempotencyKey) {
      const existing = await db.clients.get(idempotencyKey)
      if (existing) return existing
    }
    const key = data.name.toLocaleLowerCase('pt-BR')
    const clash = (await db.clients.where('farmId').equals(farmId).toArray()).find(
      (c) => c.deletedAt === null && c.name.toLocaleLowerCase('pt-BR') === key,
    )
    if (clash) throw new SaleError(`Já existe um cliente chamado "${clash.name}".`)
    return repo.create({ ...data, farmId }, idempotencyKey)
  })
}

export async function updateClient(db: ArgoDatabase, id: string, input: ClientInput): Promise<Client> {
  return new Repository(db, 'clients').update(id, cleanClient(input))
}

// ------------------------------------------------------------------ vendas

export interface SaleInput {
  date: string
  clientId: string
  mode: 'arroba' | 'cabeca' | 'kg'
  /** Venda por cabeça: quantidades. Por arroba: derivado dos animais pesados. */
  items: SaleItem[]
  weighing: 'vivo' | 'carcaca' | null
  animals: WeighedAnimal[]
  pricePerArrobaCents: number | null
  pricePerHeadCents: Partial<Record<CategoryId, number>>
  /** Venda por kg: preço do quilo vivo. */
  pricePerKgCents?: number | null
  paymentKind: PaymentKind
  installments: Installment[]
  notes: string
  /** Venda à vista já recebida: registra o recebimento junto com a venda. */
  receivedNow?: { method: PaymentMethod } | null
  /** Para a fazenda (padrão) ou para gastos pessoais. */
  purpose?: SalePurpose
  /** Venda por kg de um lote pesado antes (Pesagem de lote): o lote fica marcado como vendido. */
  weighingLotId?: string
}

export const PURPOSE_LABEL: Record<SalePurpose, string> = { fazenda: 'Para a fazenda', pessoal: 'Para gastos pessoais' }
export const salePurpose = (s: Pick<Sale, 'purpose'>): SalePurpose => s.purpose ?? 'fazenda'

/** Muda o destino da venda (fica no histórico). Não mexe em animais, parcelas nem recebimentos. */
export async function setSalePurpose(db: ArgoDatabase, id: string, purpose: SalePurpose): Promise<Sale> {
  if (purpose !== 'fazenda' && purpose !== 'pessoal') throw new SaleError('Destino inválido.')
  return new Repository(db, 'sales').update(id, { purpose })
}

function validateSale(input: SaleInput): { items: SaleItem[]; totals: Totals } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new SaleError('Informe a data da venda.')
  if (input.date > todayLocal()) throw new SaleError('A data da venda não pode ser no futuro.')
  if (!input.clientId) throw new SaleError('Escolha o cliente.')
  let items = input.items.filter((i) => i.quantity > 0)
  if (input.mode === 'arroba') {
    if (input.weighing !== 'vivo' && input.weighing !== 'carcaca') throw new SaleError('Escolha o tipo de pesagem.')
    if (input.animals.length === 0) throw new SaleError('Informe o peso de cada animal.')
    for (const a of input.animals) {
      if (!Number.isInteger(a.amount) || a.amount <= 0) throw new SaleError('Informe o peso de todos os animais.')
      if (input.weighing === 'vivo' && (a.amount < 200 || a.amount > 15000))
        throw new SaleError('Peso vivo fora do normal (entre 20 e 1.500 kg). Confira os pesos.')
      if (input.weighing === 'carcaca' && (a.amount < 100 || a.amount > 6000))
        throw new SaleError('Arrobas fora do normal (entre 1 e 60 @ por animal). Confira.')
    }
    if (!input.pricePerArrobaCents || input.pricePerArrobaCents <= 0) throw new SaleError('Informe o preço da arroba.')
    if (input.pricePerArrobaCents > 1_000_000) throw new SaleError('Preço da arroba muito alto. Confira.')
    items = itemsFromAnimals(input.animals)
  } else if (input.mode === 'kg') {
    if (input.animals.length === 0) throw new SaleError('Lance as pesagens (até 3 cabeças por vez na balança).')
    for (const a of input.animals) {
      const h = a.heads ?? 1
      if (!Number.isInteger(h) || h < 1 || h > 3) throw new SaleError('Cada pesagem deve ter de 1 a 3 cabeças.')
      if (!Number.isInteger(a.amount) || a.amount <= 0) throw new SaleError('Informe o peso de todas as pesagens.')
      // 20 a 1.500 kg por cabeça (média da pesagem)
      if (a.amount < 200 * h || a.amount > 15000 * h) throw new SaleError(`Pesagem fora do normal (${h} cab. com ${(a.amount / 10).toLocaleString('pt-BR')} kg). Confira.`)
    }
    if (!input.pricePerKgCents || input.pricePerKgCents <= 0) throw new SaleError('Informe o preço do kg.')
    if (input.pricePerKgCents > 50_000) throw new SaleError('Preço do kg muito alto. Confira.')
    const fromWeighings = itemsFromAnimals(input.animals)
    // as pesagens têm de bater com os animais escolhidos (por pasto e categoria)
    const key = (i: SaleItem) => `${i.pastureId}|${i.category}`
    const want = new Map(items.map((i) => [key(i), i.quantity]))
    const got = new Map(fromWeighings.map((i) => [key(i), i.quantity]))
    for (const [k, q] of want) if ((got.get(k) ?? 0) !== q) throw new SaleError(`Pesagens de ${category(k.split('|')[1] as CategoryId).plural.toLowerCase()}: ${got.get(k) ?? 0} de ${q} cabeças pesadas.`)
    for (const k of got.keys()) if (!want.has(k)) throw new SaleError('Há pesagem de animal que não está na venda.')
    items = fromWeighings
  } else {
    if (items.length === 0) throw new SaleError('Informe a quantidade de animais.')
    for (const it of items) {
      const p = input.pricePerHeadCents[it.category]
      if (!p || p <= 0) throw new SaleError(`Informe o preço por cabeça de ${category(it.category).label}.`)
      if (p > 10_000_000) throw new SaleError('Preço por cabeça muito alto. Confira.')
    }
  }
  const totals = computeTotals({ ...input, items })
  if (totals.totalCents <= 0) throw new SaleError('O valor da venda deve ser maior que zero.')
  if (input.installments.length === 0) throw new SaleError('Informe a forma de pagamento.')
  const sum = input.installments.reduce((a, p) => a + p.amountCents, 0)
  if (sum !== totals.totalCents) throw new SaleError('A soma das parcelas é diferente do valor da venda.')
  if (input.installments.some((p) => p.amountCents <= 0 || p.due < input.date))
    throw new SaleError('Parcelas devem ter valor e vencimento a partir da data da venda.')
  return { items, totals }
}

/**
 * Registra a venda e a saída dos animais do rebanho, na MESMA transação.
 * Se o rebanho não tiver os animais, nada é gravado.
 */
export async function createSale(db: ArgoDatabase, farmId: string, input: SaleInput, idempotencyKey?: string): Promise<Sale> {
  const sales = new Repository(db, 'sales')
  const id = idempotencyKey ?? newId()
  return db.transaction('rw', [db.sales, db.clients, db.movements, db.pastures, db.payments, db.weighingLots, db.auditLog, db.outbox, db.meta], async () => {
    const existing = await db.sales.get(id)
    if (existing) return existing
    const { items, totals } = validateSale(input)
    if (input.weighingLotId) {
      const lot = await db.weighingLots.get(input.weighingLotId)
      if (!lot || lot.farmId !== farmId || lot.deletedAt !== null) throw new SaleError('Pesagem do lote não encontrada.')
      if (lot.status !== 'aberta') throw new SaleError('Este lote já foi vendido ou cancelado.')
      if (input.mode !== 'kg' || !sameWeighings(lot, input.animals)) throw new SaleError('As pesagens da venda são diferentes das do lote. Abra o lote de novo.')
    }
    const client = await db.clients.get(input.clientId)
    if (!client || client.farmId !== farmId || client.deletedAt !== null) throw new SaleError('Cliente não encontrado.')
    const pastures = await db.pastures.bulkGet([...new Set(items.map((i) => i.pastureId))])
    if (pastures.some((p) => !p || p.farmId !== farmId)) throw new SaleError('Pasto não pertence a esta fazenda.')

    const numbers = (await db.sales.where('farmId').equals(farmId).toArray()).map((s) => s.number)
    const number = numbers.length ? Math.max(...numbers) + 1 : 1

    let movementId: string
    try {
      const entries = items.flatMap((it) => entriesOut(it.pastureId, { [it.category]: it.quantity }))
      const m = await recordMovement(db, {
        type: 'venda',
        date: input.date,
        entries,
        notes: `Venda nº ${number} — ${client.name}`,
        saleId: id,
      })
      movementId = m.id
    } catch (e) {
      if (e instanceof HerdError) throw new SaleError(e.message)
      throw e
    }

    const sale = await sales.create(
      {
        farmId,
        number,
        date: input.date,
        clientId: input.clientId,
        mode: input.mode,
        items,
        weighing: input.mode === 'arroba' ? input.weighing : input.mode === 'kg' ? 'vivo' : null,
        animals: input.mode === 'arroba' ? input.animals : input.mode === 'kg' ? input.animals.map((a) => ({ pastureId: a.pastureId, category: a.category, amount: a.amount, heads: a.heads ?? 1 })) : [],
        pricePerArrobaCents: input.mode === 'arroba' ? input.pricePerArrobaCents : null,
        pricePerKgCents: input.mode === 'kg' ? (input.pricePerKgCents ?? null) : null,
        pricePerHeadCents: input.mode === 'cabeca' ? input.pricePerHeadCents : {},
        arrobasHundredths: totals.arrobasHundredths,
        totalCents: totals.totalCents,
        paymentKind: input.paymentKind,
        installments: input.installments,
        notes: input.notes.trim(),
        movementId,
        status: 'ativa',
        canceledAt: null,
        cancelReason: '',
        purpose: input.purpose === 'pessoal' ? 'pessoal' : 'fazenda',
      },
      id,
    )
    if (input.weighingLotId) await new Repository(db, 'weighingLots').update(input.weighingLotId, { status: 'vendida', saleId: sale.id })
    if (input.receivedNow && input.paymentKind === 'avista') {
      try {
        await recordPayment(
          db,
          farmId,
          { saleId: sale.id, date: input.date, amountCents: sale.totalCents, method: input.receivedNow.method, notes: 'Recebido na venda' },
          `${sale.id}-avista`,
        )
      } catch (e) {
        if (e instanceof PaymentError) throw new SaleError(e.message)
        throw e
      }
    }
    return sale
  })
}

/** Cancela a venda: devolve os animais ao rebanho (estorno) e marca a venda como cancelada. */
export async function cancelSale(db: ArgoDatabase, id: string, reason: string): Promise<Sale> {
  const sales = new Repository(db, 'sales')
  return db.transaction('rw', [db.sales, db.movements, db.pastures, db.payments, db.auditLog, db.outbox, db.meta], async () => {
    const sale = await db.sales.get(id)
    if (!sale) throw new SaleError('Venda não encontrada.')
    if (sale.status === 'cancelada') throw new SaleError('Esta venda já foi cancelada.')
    if (activePayments(await db.payments.where('saleId').equals(id).toArray()).length > 0)
      throw new SaleError('Esta venda tem recebimentos. Estorne os recebimentos antes de cancelar a venda.')
    await reverseMovement(db, sale.movementId, `Cancelamento da venda nº ${sale.number}${reason ? ` — ${reason}` : ''}`, {
      fromSale: true,
    })
    return sales.update(id, { status: 'cancelada', canceledAt: nowIso(), cancelReason: reason.trim() })
  })
}

export function formatSaleNumber(n: number): string {
  return String(n).padStart(4, '0')
}

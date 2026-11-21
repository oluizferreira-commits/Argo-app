import { nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Supply, SupplyMovement } from '../../db/types'
import { todayLocal } from '../rebanho/herd'

export class SupplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupplyError'
  }
}

/** Saída que deixaria o estoque negativo: precisa de autorização explícita. */
export class NegativeStockError extends SupplyError {
  readonly availableHalves: number
  constructor(availableHalves: number) {
    super(`Estoque insuficiente: há ${formatSacks(availableHalves)}. Para lançar assim mesmo, é preciso autorizar.`)
    this.name = 'NegativeStockError'
    this.availableHalves = availableHalves
  }
}

/** Produtos iniciais (sem estoque e sem peso: o usuário informa o peso do saco). */
export const DEFAULT_SUPPLIES = ['Sal branco', 'Sal mineral']

// ------------------------------------------------------------------ unidades

/** "1" → 2 ; "0,5" → 1 ; "2,5" → 5. Só sacos inteiros ou meio saco. */
export function parseSacks(text: string): number {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) throw new SupplyError('Informe a quantidade de sacos (ex.: 1; 0,5; 2,5).')
  const halves = Number(t) * 2
  if (!Number.isInteger(halves)) throw new SupplyError('Use sacos inteiros ou meio saco (ex.: 0,5; 1; 1,5).')
  if (halves <= 0) throw new SupplyError('A quantidade deve ser maior que zero.')
  if (halves > 200000) throw new SupplyError('Quantidade muito alta. Confira o número.')
  return halves
}

export function formatSacks(halves: number): string {
  const n = halves / 2
  const abs = Math.abs(n)
  const txt = n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  return `${txt} ${abs > 1 || abs === 0 ? 'sacos' : 'saco'}`
}

/** kg equivalentes (null se o peso do saco não foi informado). */
export function sacksToKg(halves: number, gramsPerSack: number | null): number | null {
  if (!gramsPerSack) return null
  return (halves * gramsPerSack) / 2 / 1000
}

export function formatKg(kg: number | null): string {
  if (kg === null) return '—'
  return `${kg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`
}

/** "25" ou "25,5" kg → gramas. */
export function parseKgPerSack(text: string): number {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,3})?$/.test(t)) throw new SupplyError('Informe o peso do saco em kg (ex.: 25 ou 30).')
  const g = Math.round(Number(t) * 1000)
  if (g <= 0 || g > 1000000) throw new SupplyError('Peso do saco inválido.')
  return g
}

// ------------------------------------------------------------------ produtos

const activeMov = (m: SupplyMovement) => m.status === 'ativo' && m.deletedAt === null

export function supplyStock(movements: readonly SupplyMovement[], supplyId: string): number {
  return movements.filter((m) => m.supplyId === supplyId && activeMov(m)).reduce((a, m) => a + m.halfSacks, 0)
}

function cleanSupply(name: string) {
  const n = name.trim().replace(/\s+/g, ' ')
  if (!n) throw new SupplyError('Informe o nome do produto.')
  if (n.length > 60) throw new SupplyError('Nome muito longo (máx. 60 caracteres).')
  return n
}

async function assertUniqueSupply(db: ArgoDatabase, farmId: string, name: string, exceptId?: string) {
  const key = name.toLocaleLowerCase('pt-BR')
  const clash = (await db.supplies.where('farmId').equals(farmId).toArray()).find(
    (s) => s.deletedAt === null && s.id !== exceptId && s.name.toLocaleLowerCase('pt-BR') === key,
  )
  if (clash) throw new SupplyError(`Já existe o produto "${clash.name}".`)
}

export async function createSupply(db: ArgoDatabase, farmId: string, name: string, gramsPerSack: number | null, key?: string): Promise<Supply> {
  const n = cleanSupply(name)
  return db.transaction('rw', [db.supplies, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const existing = await db.supplies.get(key)
      if (existing) return existing
    }
    await assertUniqueSupply(db, farmId, n)
    return new Repository(db, 'supplies').create({ farmId, name: n, gramsPerSack, active: true }, key)
  })
}

/** Cria Sal branco e Sal mineral na primeira vez (uma só vez por fazenda). */
export async function ensureDefaultSupplies(db: ArgoDatabase, farmId: string): Promise<void> {
  const existing = await db.supplies.where('farmId').equals(farmId).count()
  if (existing > 0) return
  for (const name of DEFAULT_SUPPLIES) {
    try {
      await createSupply(db, farmId, name, null, `${farmId}-insumo-${name.toLowerCase().replace(/\s+/g, '-')}`)
    } catch {
      /* já criado em outra aba */
    }
  }
}

export async function updateSupply(db: ArgoDatabase, s: Supply, name: string, gramsPerSack: number | null): Promise<Supply> {
  const n = cleanSupply(name)
  return db.transaction('rw', [db.supplies, db.auditLog, db.outbox, db.meta], async () => {
    await assertUniqueSupply(db, s.farmId, n, s.id)
    return new Repository(db, 'supplies').update(s.id, { name: n, gramsPerSack })
  })
}

export async function setSupplyActive(db: ArgoDatabase, id: string, active: boolean): Promise<Supply> {
  return new Repository(db, 'supplies').update(id, { active })
}

// ------------------------------------------------------------------ movimentos

export interface SupplyMovementInput {
  supplyId: string
  type: 'compra' | 'consumo' | 'ajuste'
  date: string
  /** quantidade positiva em meios sacos */
  halves: number
  /** ajuste: entrada ou saída */
  direction?: 'entrada' | 'saida'
  costCents?: number | null
  supplier?: string
  pastureId?: string | null
  notes?: string
}

export async function recordSupplyMovement(
  db: ArgoDatabase,
  farmId: string,
  input: SupplyMovementInput,
  key?: string,
  authorize?: { reason: string },
): Promise<SupplyMovement> {
  if (!Number.isInteger(input.halves) || input.halves <= 0) throw new SupplyError('Informe a quantidade de sacos.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new SupplyError('Informe a data.')
  if (input.date > todayLocal()) throw new SupplyError('A data não pode ser no futuro.')
  const notes = (input.notes ?? '').trim()
  const supplier = (input.supplier ?? '').trim()
  let sign = 1
  if (input.type === 'compra') {
    if (!input.costCents || input.costCents <= 0) throw new SupplyError('Informe o valor pago.')
    if (!supplier) throw new SupplyError('Informe o fornecedor.')
  } else if (input.type === 'consumo') {
    if (!input.pastureId) throw new SupplyError('Escolha o pasto (cocho).')
    sign = -1
  } else {
    if (!input.direction) throw new SupplyError('Escolha se o ajuste é entrada ou saída.')
    if (!notes) throw new SupplyError('Informe o motivo do ajuste.')
    sign = input.direction === 'entrada' ? 1 : -1
  }
  return db.transaction('rw', [db.supplyMovements, db.supplies, db.pastures, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const existing = await db.supplyMovements.get(key)
      if (existing) return existing
    }
    const supply = await db.supplies.get(input.supplyId)
    if (!supply || supply.farmId !== farmId) throw new SupplyError('Produto não encontrado.')
    if (input.type === 'consumo') {
      const p = await db.pastures.get(input.pastureId!)
      if (!p || p.farmId !== farmId || p.deletedAt !== null) throw new SupplyError('Pasto não encontrado.')
    }
    let authorized = false
    if (sign < 0) {
      const stock = supplyStock(await db.supplyMovements.where('supplyId').equals(supply.id).toArray(), supply.id)
      if (stock - input.halves < 0) {
        if (!authorize?.reason.trim()) throw new NegativeStockError(stock)
        authorized = true
      }
    }
    return new Repository(db, 'supplyMovements').create(
      {
        farmId,
        supplyId: supply.id,
        type: input.type,
        date: input.date,
        halfSacks: sign * input.halves,
        costCents: input.type === 'compra' ? input.costCents! : null,
        supplier: input.type === 'compra' ? supplier : '',
        pastureId: input.type === 'consumo' ? input.pastureId! : null,
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
export async function reverseSupplyMovement(db: ArgoDatabase, id: string, reason: string): Promise<SupplyMovement> {
  return db.transaction('rw', [db.supplyMovements, db.auditLog, db.outbox, db.meta], async () => {
    const m = await db.supplyMovements.get(id)
    if (!m) throw new SupplyError('Lançamento não encontrado.')
    if (m.status === 'estornado') throw new SupplyError('Este lançamento já foi estornado.')
    if (m.halfSacks > 0) {
      const stock = supplyStock(await db.supplyMovements.where('supplyId').equals(m.supplyId).toArray(), m.supplyId)
      if (stock - m.halfSacks < 0) throw new SupplyError('Não é possível estornar: o estoque ficaria negativo (já houve consumo).')
    }
    return new Repository(db, 'supplyMovements').update(id, { status: 'estornado', reversedAt: nowIso(), reverseReason: reason.trim() })
  })
}

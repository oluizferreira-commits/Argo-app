import { newId, nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { RecipeItem, Supply, SupplyMovement } from '../../db/types'
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
  constructor(availableHalves: number, message?: string) {
    super(message ?? `Estoque insuficiente: há ${formatSacks(availableHalves)}. Para lançar assim mesmo, é preciso autorizar.`)
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

export async function createSupply(
  db: ArgoDatabase,
  farmId: string,
  name: string,
  gramsPerSack: number | null,
  key?: string,
  mixture?: { recipe: RecipeItem[]; yieldHalves: number },
): Promise<Supply> {
  const n = cleanSupply(name)
  return db.transaction('rw', [db.supplies, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const existing = await db.supplies.get(key)
      if (existing) return existing
    }
    await assertUniqueSupply(db, farmId, n)
    return new Repository(db, 'supplies').create({ farmId, name: n, gramsPerSack, active: true, recipe: mixture?.recipe ?? null, yieldHalves: mixture?.yieldHalves ?? null }, key)
  })
}

const defaultKey = (farmId: string, slug: string) => `${farmId}-insumo-${slug}`

/** Receita inicial da mistura: 3 sacos de sal branco + 1 de mineral rendem 6 sacos (o responsável pode alterar). */
export const DEFAULT_MIXTURE = { name: 'Mistura de sal', branco: 6, mineral: 2, yieldHalves: 12 }

/**
 * Cria, uma vez por fazenda, Sal branco, Sal mineral e a Mistura de sal (chaves fixas: nunca duplica,
 * e um produto renomeado ou desativado não é recriado).
 */
export async function ensureDefaultSupplies(db: ArgoDatabase, farmId: string): Promise<void> {
  const brancoKey = defaultKey(farmId, 'sal-branco')
  const mineralKey = defaultKey(farmId, 'sal-mineral')
  const mixKey = defaultKey(farmId, 'mistura-de-sal')
  const all = await db.supplies.where('farmId').equals(farmId).toArray()
  // fazenda nova: cria Sal branco e Sal mineral
  if (all.length === 0) {
    for (const [name, key] of [['Sal branco', brancoKey], ['Sal mineral', mineralKey]] as const) {
      try {
        await createSupply(db, farmId, name, null, key)
      } catch {
        /* já criado em outra aba */
      }
    }
  }
  if (await db.supplies.get(mixKey)) return
  const branco = await db.supplies.get(brancoKey)
  const mineral = await db.supplies.get(mineralKey)
  if (!branco || !mineral || branco.deletedAt || mineral.deletedAt) return
  try {
    await createSupply(db, farmId, DEFAULT_MIXTURE.name, null, mixKey, {
      recipe: [
        { supplyId: branco.id, halves: DEFAULT_MIXTURE.branco },
        { supplyId: mineral.id, halves: DEFAULT_MIXTURE.mineral },
      ],
      yieldHalves: DEFAULT_MIXTURE.yieldHalves,
    })
  } catch {
    /* nome já usado por um produto do usuário: não cria */
  }
}

export const isMixture = (s: Supply) => Boolean(s.recipe && s.recipe.length > 0)

/** Mistura ativa que usa este produto como ingrediente (se houver). */
export function mixtureUsing(supplies: readonly Supply[], supplyId: string): Supply | undefined {
  return supplies.find((m) => m.deletedAt === null && m.active && isMixture(m) && m.recipe!.some((r) => r.supplyId === supplyId))
}

/** "3 sacos de Sal branco + 1 saco de Sal mineral → 6 sacos" */
export function recipeText(mix: Supply, names: Map<string, string>): string {
  const parts = (mix.recipe ?? []).map((r) => `${formatSacks(r.halves)} de ${names.get(r.supplyId) ?? '—'}`)
  return `${parts.join(' + ')} → ${formatSacks(mix.yieldHalves ?? 0)}`
}

/** Define a receita de UMA mistura: ingredientes e rendimento, em meios sacos. Vale para as próximas misturas. */
export async function setRecipe(db: ArgoDatabase, mixtureId: string, recipe: RecipeItem[], yieldHalves: number): Promise<Supply> {
  const items = recipe.filter((r) => r.halves !== 0)
  if (items.length === 0) throw new SupplyError('Informe pelo menos um ingrediente.')
  for (const r of items) if (!Number.isInteger(r.halves) || r.halves < 0) throw new SupplyError('Use sacos inteiros ou meio saco nos ingredientes.')
  if (!Number.isInteger(yieldHalves) || yieldHalves <= 0) throw new SupplyError('Informe quantos sacos de mistura rende.')
  if (new Set(items.map((r) => r.supplyId)).size !== items.length) throw new SupplyError('Ingrediente repetido.')
  return db.transaction('rw', [db.supplies, db.auditLog, db.outbox, db.meta], async () => {
    const mix = await db.supplies.get(mixtureId)
    if (!mix || !isMixture(mix)) throw new SupplyError('Mistura não encontrada.')
    for (const r of items) {
      const ing = await db.supplies.get(r.supplyId)
      if (!ing || ing.farmId !== mix.farmId || ing.deletedAt !== null || ing.id === mix.id || isMixture(ing)) throw new SupplyError('Ingrediente inválido.')
    }
    return new Repository(db, 'supplies').update(mixtureId, { recipe: items, yieldHalves })
  })
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
    if (input.type !== 'ajuste') throw new SupplyError('Tipo de lançamento inválido.')
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
    if (input.type === 'compra' && isMixture(supply)) throw new SupplyError('A mistura não é comprada: lance "Mistura feita".')
    if (input.type === 'consumo') {
      const mix = mixtureUsing(await db.supplies.where('farmId').equals(farmId).toArray(), supply.id)
      if (mix) throw new SupplyError(`${supply.name} vai para o cocho misturado: lance o consumo em "${mix.name}".`)
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

// ------------------------------------------------------------------ mistura

/**
 * "Mistura feita": tira os ingredientes do estoque e soma a mistura, conforme a receita atual.
 * `batches` = quantas misturas (inteiro). Ingrediente insuficiente → NegativeStockError (salvo com autorização).
 */
export async function recordMixture(
  db: ArgoDatabase,
  farmId: string,
  input: { mixtureId: string; batches: number; date: string; notes?: string },
  key?: string,
  authorize?: { reason: string },
): Promise<SupplyMovement> {
  const { batches } = input
  if (!Number.isInteger(batches) || batches <= 0) throw new SupplyError('Informe quantas misturas foram feitas.')
  if (batches > 1000) throw new SupplyError('Quantidade muito alta. Confira o número.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new SupplyError('Informe a data.')
  if (input.date > todayLocal()) throw new SupplyError('A data não pode ser no futuro.')
  const notes = (input.notes ?? '').trim()
  return db.transaction('rw', [db.supplyMovements, db.supplies, db.auditLog, db.outbox, db.meta], async () => {
    const batchId = key ?? newId()
    const existing = await db.supplyMovements.get(batchId)
    if (existing) return existing
    const mix = await db.supplies.get(input.mixtureId)
    if (!mix || mix.farmId !== farmId || !isMixture(mix) || !mix.yieldHalves) throw new SupplyError('Mistura não encontrada.')
    const movements = await db.supplyMovements.where('farmId').equals(farmId).toArray()
    const short: string[] = []
    const ingredients: { supply: Supply; halves: number }[] = []
    for (const r of mix.recipe!) {
      const ing = await db.supplies.get(r.supplyId)
      if (!ing || ing.deletedAt !== null) throw new SupplyError('Um ingrediente da receita não existe mais. Revise a receita.')
      const need = r.halves * batches
      const stock = supplyStock(movements, ing.id)
      if (stock - need < 0) short.push(`${ing.name}: precisa de ${formatSacks(need)}, há ${formatSacks(stock)}`)
      ingredients.push({ supply: ing, halves: need })
    }
    const authorized = short.length > 0
    if (authorized && !authorize?.reason.trim())
      throw new NegativeStockError(0, `Estoque insuficiente — ${short.join('; ')}. Para lançar assim mesmo, é preciso autorizar.`)
    const label = `Mistura feita: ${batches} mistura${batches > 1 ? 's' : ''}`
    const extra = [notes, authorized ? `Estoque negativo autorizado: ${authorize!.reason.trim()}` : ''].filter(Boolean).join(' · ')
    const repo = new Repository(db, 'supplyMovements')
    const base = { farmId, type: 'mistura' as const, date: input.date, costCents: null, supplier: '', pastureId: null, batchId, status: 'ativo' as const, reversedAt: null, reverseReason: '' }
    for (const [i, ing] of ingredients.entries()) {
      const neg = authorized && short.some((t) => t.startsWith(`${ing.supply.name}:`))
      await repo.create(
        { ...base, supplyId: ing.supply.id, halfSacks: -ing.halves, notes: `${label} (${mix.name})${extra ? ` · ${extra}` : ''}`, authorizedNegative: neg },
        `${batchId}-${i + 1}`,
      )
    }
    return repo.create({ ...base, supplyId: mix.id, halfSacks: mix.yieldHalves * batches, notes: `${label}${extra ? ` · ${extra}` : ''}`, authorizedNegative: false }, batchId)
  })
}

/**
 * Estorna um lançamento (fica no histórico). Estornar uma entrada não pode deixar o estoque negativo.
 * Lançamentos de uma mesma mistura são estornados juntos.
 */
export async function reverseSupplyMovement(db: ArgoDatabase, id: string, reason: string): Promise<SupplyMovement> {
  return db.transaction('rw', [db.supplyMovements, db.auditLog, db.outbox, db.meta], async () => {
    const m = await db.supplyMovements.get(id)
    if (!m) throw new SupplyError('Lançamento não encontrado.')
    if (m.status === 'estornado') throw new SupplyError('Este lançamento já foi estornado.')
    const all = await db.supplyMovements.where('farmId').equals(m.farmId).toArray()
    const group = m.batchId ? all.filter((x) => x.batchId === m.batchId && x.status === 'ativo') : [m]
    for (const g of group) {
      if (g.halfSacks > 0 && supplyStock(all, g.supplyId) - g.halfSacks < 0)
        throw new SupplyError(
          g.type === 'mistura'
            ? 'Não é possível estornar a mistura: parte dela já foi para o cocho. Estorne antes esses consumos.'
            : 'Não é possível estornar: o estoque ficaria negativo (já houve consumo).',
        )
    }
    const repo = new Repository(db, 'supplyMovements')
    const at = nowIso()
    let result = m
    for (const g of group) {
      const u = await repo.update(g.id, { status: 'estornado', reversedAt: at, reverseReason: reason.trim() })
      if (g.id === id) result = u
    }
    return result
  })
}

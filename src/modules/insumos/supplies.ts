import { newId, nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { RecipeItem, Supply, SupplyCategory, SupplyMovement, SupplyUnit } from '../../db/types'
import { formatMoney, parseDecimal } from '../../core/money'
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

// ------------------------------------------------------------------ unidades (saco, litro, kg)

export const unitOf = (s: Pick<Supply, 'unit'>): SupplyUnit => s.unit ?? 'saco'
export const categoryOf = (s: Pick<Supply, 'category'>): SupplyCategory => s.category ?? 'geral'
export const UNIT_LABEL: Record<SupplyUnit, string> = { saco: 'sacos', L: 'litros', kg: 'kg' }
export const CATEGORY_LABEL: Record<SupplyCategory, string> = { geral: 'Sal e insumos', herbicida: 'Herbicidas', semente: 'Sementes' }

/** Quantidade de um lançamento na unidade do estoque: meios sacos (saco) ou mL/g (L/kg). */
export const movQty = (m: Pick<SupplyMovement, 'qty' | 'halfSacks'>) => m.qty ?? m.halfSacks

/** "150" ou "12,5" litros/kg → mL/g. Até 3 casas. */
export function parseMilli(text: string): number {
  const v = parseDecimal(text, 3)
  if (v === null || v <= 0) throw new SupplyError('Informe a quantidade (ex.: 20 ou 12,5).')
  if (v > 1_000_000_000) throw new SupplyError('Quantidade muito alta. Confira o número.')
  return v
}

/** Lê a quantidade digitada na unidade do produto. */
export function parseQty(text: string, unit: SupplyUnit): number {
  return unit === 'saco' ? parseSacks(text) : parseMilli(text)
}

export function formatQty(amount: number, unit: SupplyUnit): string {
  if (unit === 'saco') return formatSacks(amount)
  return `${(amount / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`
}

/** Preço por unidade (R$/L, R$/kg ou R$/saco) a partir de valor e quantidade. */
export function unitPrice(cents: number, amount: number, unit: SupplyUnit): string {
  if (!amount) return '—'
  const per = unit === 'saco' ? (cents * 2) / amount : (cents * 1000) / amount
  return `${formatMoney(Math.round(per))}/${unit === 'saco' ? 'saco' : unit}`
}

// ------------------------------------------------------------------ custo médio ponderado

export interface SupplyLedger {
  balance: number
  /** valor do estoque (centavos) */
  valueCents: number
  /** custo de cada lançamento de saída, pelo custo médio do momento */
  costById: Map<string, number>
}

/** Custo médio ponderado (em ordem de data): compras somam valor; saídas saem pelo custo médio do momento. */
export function supplyLedger(movements: readonly SupplyMovement[], supplyId: string, upTo?: { date: string }): SupplyLedger {
  let balance = 0
  let value = 0
  const costById = new Map<string, number>()
  const list = movements
    .filter((m) => m.supplyId === supplyId && m.status === 'ativo' && m.deletedAt === null && (!upTo || m.date <= upTo.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  for (const m of list) {
    const q = movQty(m)
    if (q > 0 && m.type === 'compra' && m.costCents) {
      if (balance <= 0) {
        balance += q
        value = balance > 0 ? Math.round((m.costCents * balance) / q) : 0
      } else {
        balance += q
        value += m.costCents
      }
    } else if (q > 0) {
      // entrada sem valor (ajuste, mistura): entra pelo custo médio atual
      value += balance > 0 ? Math.round((value * q) / balance) : 0
      balance += q
    } else {
      const cost = balance > 0 ? Math.round((value * -q) / balance) : 0
      costById.set(m.id, cost)
      balance += q
      value = balance > 0 ? value - cost : 0
    }
  }
  return { balance, valueCents: Math.max(0, value), costById }
}

// ------------------------------------------------------------------ produtos

const activeMov = (m: SupplyMovement) => m.status === 'ativo' && m.deletedAt === null

export function supplyStock(movements: readonly SupplyMovement[], supplyId: string): number {
  return movements.filter((m) => m.supplyId === supplyId && activeMov(m)).reduce((a, m) => a + movQty(m), 0)
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
  details?: SupplyDetails,
): Promise<Supply> {
  const n = cleanSupply(name)
  const extra = details ? cleanDetails(details) : {}
  return db.transaction('rw', [db.supplies, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const existing = await db.supplies.get(key)
      if (existing) return existing
    }
    await assertUniqueSupply(db, farmId, n)
    return new Repository(db, 'supplies').create({ farmId, name: n, gramsPerSack, active: true, recipe: mixture?.recipe ?? null, yieldHalves: mixture?.yieldHalves ?? null, ...extra }, key)
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

/** Dados do cadastro de herbicidas e sementes (e do estoque mínimo de qualquer produto). */
export interface SupplyDetails {
  category: SupplyCategory
  unit: SupplyUnit
  manufacturer?: string
  activeIngredient?: string
  species?: string
  cultivar?: string
  /** VC% × 10 */
  culturalValue?: number | null
  minQty?: number | null
  notes?: string
}

function cleanDetails(d: SupplyDetails): Partial<Supply> {
  if (!['geral', 'herbicida', 'semente'].includes(d.category)) throw new SupplyError('Categoria inválida.')
  if (!['saco', 'L', 'kg'].includes(d.unit)) throw new SupplyError('Unidade inválida.')
  if (d.category === 'semente' && !d.species?.trim()) throw new SupplyError('Informe a espécie do capim (ex.: Brachiaria brizantha, Panicum maximum).')
  if (d.culturalValue != null && (d.culturalValue <= 0 || d.culturalValue > 1000)) throw new SupplyError('Valor cultural (VC%) deve ficar entre 0 e 100.')
  if (d.minQty != null && d.minQty < 0) throw new SupplyError('Estoque mínimo inválido.')
  const t = (x: string | undefined, max: number) => (x ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
  return {
    category: d.category,
    unit: d.unit,
    manufacturer: t(d.manufacturer, 60),
    activeIngredient: t(d.activeIngredient, 80),
    species: t(d.species, 60),
    cultivar: t(d.cultivar, 60),
    culturalValue: d.culturalValue ?? null,
    minQty: d.minQty ?? null,
    notes: t(d.notes, 1000),
  }
}

export async function updateSupply(db: ArgoDatabase, s: Supply, name: string, gramsPerSack: number | null, details?: SupplyDetails): Promise<Supply> {
  const n = cleanSupply(name)
  const extra = details ? cleanDetails(details) : {}
  return db.transaction('rw', [db.supplies, db.supplyMovements, db.auditLog, db.outbox, db.meta], async () => {
    await assertUniqueSupply(db, s.farmId, n, s.id)
    if (details && unitOf(s) !== details.unit && (await db.supplyMovements.where('supplyId').equals(s.id).count()) > 0)
      throw new SupplyError('A unidade não pode mudar depois que o produto já tem lançamentos.')
    return new Repository(db, 'supplies').update(s.id, { name: n, gramsPerSack, ...extra })
  })
}

/** Estoque abaixo do mínimo cadastrado (só quando o produto tem mínimo). */
export function isLowStock(s: Pick<Supply, 'minQty'>, stock: number): boolean {
  return s.minQty != null && s.minQty > 0 && stock < s.minQty
}

export async function setSupplyActive(db: ArgoDatabase, id: string, active: boolean): Promise<Supply> {
  return new Repository(db, 'supplies').update(id, { active })
}

// ------------------------------------------------------------------ movimentos

export interface SupplyMovementInput {
  supplyId: string
  type: 'compra' | 'consumo' | 'ajuste'
  date: string
  /** quantidade positiva em meios sacos (produtos em saco) */
  halves?: number
  /** quantidade positiva em mL/g (produtos em L/kg) */
  qty?: number
  /** compra: nota fiscal e lote */
  invoice?: string
  lot?: string
  /** consumo de uma operação de campo */
  operationId?: string
  /** baixa de peça/óleo/filtro numa manutenção */
  maintenanceId?: string
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new SupplyError('Informe a data.')
  if (input.date > todayLocal()) throw new SupplyError('A data não pode ser no futuro.')
  const notes = (input.notes ?? '').trim()
  const supplier = (input.supplier ?? '').trim()
  let sign = 1
  if (input.type === 'compra') {
    if (!input.costCents || input.costCents <= 0) throw new SupplyError('Informe o valor pago.')
    if (!supplier) throw new SupplyError('Informe o fornecedor.')
  } else if (input.type === 'consumo') {
    if (!input.pastureId && !input.operationId && !input.maintenanceId) throw new SupplyError('Escolha o pasto (cocho).')
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
    const unit = unitOf(supply)
    const amount = unit === 'saco' ? input.halves : input.qty
    if (amount === undefined || !Number.isInteger(amount) || amount <= 0) throw new SupplyError(unit === 'saco' ? 'Informe a quantidade de sacos.' : 'Informe a quantidade.')
    if (input.type === 'compra' && isMixture(supply)) throw new SupplyError('A mistura não é comprada: lance "Mistura feita".')
    if (input.type === 'consumo') {
      const mix = input.operationId || input.maintenanceId ? undefined : mixtureUsing(await db.supplies.where('farmId').equals(farmId).toArray(), supply.id)
      if (mix) throw new SupplyError(`${supply.name} vai para o cocho misturado: lance o consumo em "${mix.name}".`)
      if (input.pastureId) {
        const p = await db.pastures.get(input.pastureId)
        if (!p || p.farmId !== farmId || p.deletedAt !== null) throw new SupplyError('Pasto não encontrado.')
      }
    }
    let authorized = false
    const movs = await db.supplyMovements.where('supplyId').equals(supply.id).toArray()
    if (sign < 0) {
      const stock = supplyStock(movs, supply.id)
      if (stock - amount < 0) {
        if (!authorize?.reason.trim()) throw new NegativeStockError(stock, unit === 'saco' ? undefined : `Estoque insuficiente de ${supply.name}: há ${formatQty(stock, unit)}. Para lançar assim mesmo, é preciso autorizar.`)
        authorized = true
      }
    }
    // saída: guarda o custo pelo custo médio do estoque na data (preserva o custo histórico)
    let outCost: number | null = null
    if (sign < 0) {
      const tmpId = '__saida__'
      const probe = { id: tmpId, supplyId: supply.id, type: input.type, date: input.date, halfSacks: unit === 'saco' ? -amount : 0, qty: unit === 'saco' ? null : -amount, status: 'ativo', deletedAt: null, createdAt: '9999', costCents: null } as unknown as SupplyMovement
      outCost = supplyLedger([...movs, probe], supply.id).costById.get(tmpId) ?? 0
    }
    return new Repository(db, 'supplyMovements').create(
      {
        farmId,
        supplyId: supply.id,
        type: input.type,
        date: input.date,
        halfSacks: unit === 'saco' ? sign * amount : 0,
        qty: unit === 'saco' ? null : sign * amount,
        invoice: input.type === 'compra' ? (input.invoice ?? '').trim().slice(0, 40) : '',
        lot: (input.lot ?? '').trim().slice(0, 40),
        operationId: input.operationId ?? null,
        maintenanceId: input.maintenanceId ?? null,
        costCents: input.type === 'compra' ? input.costCents! : outCost,
        supplier: input.type === 'compra' ? supplier : '',
        pastureId: input.type === 'consumo' ? (input.pastureId ?? null) : null,
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
export async function reverseSupplyMovement(db: ArgoDatabase, id: string, reason: string, fromOperation = false): Promise<SupplyMovement> {
  return db.transaction('rw', [db.supplyMovements, db.auditLog, db.outbox, db.meta], async () => {
    const m = await db.supplyMovements.get(id)
    if (!m) throw new SupplyError('Lançamento não encontrado.')
    if (m.status === 'estornado') throw new SupplyError('Este lançamento já foi estornado.')
    if (m.operationId && !fromOperation) throw new SupplyError('Este consumo é de uma operação de campo: corrija ou cancele pela operação.')
    if (m.maintenanceId && !fromOperation) throw new SupplyError('Esta baixa é de uma manutenção: corrija ou cancele pela manutenção.')
    const all = await db.supplyMovements.where('farmId').equals(m.farmId).toArray()
    const group = m.batchId ? all.filter((x) => x.batchId === m.batchId && x.status === 'ativo') : [m]
    for (const g of group) {
      if (movQty(g) > 0 && supplyStock(all, g.supplyId) - movQty(g) < 0)
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

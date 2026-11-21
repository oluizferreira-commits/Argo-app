import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Movement, MovementEntry } from '../../db/types'
import { CATEGORIES, category, isCategoryId, isUnspecified, laterCategories, NEWBORN_CATEGORIES, UNSPECIFIED, type CategoryId, type Sex } from '../../domain/categories'
import { COUNT_REASONS, type CountReason, type MovementType } from '../../domain/movements'

export class HerdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HerdError'
  }
}

// ------------------------------------------------------------------ saldos

export const balanceKey = (pastureId: string, cat: CategoryId) => `${pastureId}|${cat}`

/** Saldo por pasto/categoria = soma de todas as linhas de todas as movimentações. */
export function computeBalances(movements: readonly Movement[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of movements) {
    if (m.deletedAt !== null) continue
    for (const e of m.entries) {
      const k = balanceKey(e.pastureId, e.category)
      map.set(k, (map.get(k) ?? 0) + e.delta)
    }
  }
  return map
}

export function balanceOf(balances: Map<string, number>, pastureId: string, cat: CategoryId): number {
  return balances.get(balanceKey(pastureId, cat)) ?? 0
}

export function pastureTotal(balances: Map<string, number>, pastureId: string): number {
  let t = 0
  for (const [k, v] of balances) if (k.startsWith(`${pastureId}|`)) t += v
  return t
}

/** Totais por categoria somando só os pastos informados (pastos ativos). */
export function totalsByCategory(balances: Map<string, number>, pastureIds: readonly string[]): Map<CategoryId, number> {
  const ids = new Set(pastureIds)
  const out = new Map<CategoryId, number>()
  for (const [k, v] of balances) {
    const [p, c] = k.split('|') as [string, CategoryId]
    if (ids.has(p)) out.set(c, (out.get(c) ?? 0) + v)
  }
  return out
}

// ------------------------------------------------------------ montagem das linhas

export type Quantities = Partial<Record<CategoryId, number>>

function positive(q: Quantities): [CategoryId, number][] {
  return (Object.entries(q) as [CategoryId, number][]).filter(([, n]) => n > 0)
}

/** Nascimento, compra: soma no pasto. */
export function entriesIn(pastureId: string, q: Quantities): MovementEntry[] {
  return positive(q).map(([category, n]) => ({ pastureId, category, delta: n }))
}

/** Morte, venda: tira do pasto. */
export function entriesOut(pastureId: string, q: Quantities): MovementEntry[] {
  return positive(q).map(([category, n]) => ({ pastureId, category, delta: -n }))
}

export function entriesTransfer(fromId: string, toId: string, q: Quantities): MovementEntry[] {
  return positive(q).flatMap(([category, n]) => [
    { pastureId: fromId, category, delta: -n },
    { pastureId: toId, category, delta: n },
  ])
}

export interface CategoryChangeLine {
  from: CategoryId
  to: CategoryId
  quantity: number
}

export function entriesCategoryChange(fromId: string, toId: string, lines: readonly CategoryChangeLine[]): MovementEntry[] {
  return lines
    .filter((l) => l.quantity > 0)
    .flatMap((l) => [
      { pastureId: fromId, category: l.from, delta: -l.quantity },
      { pastureId: toId, category: l.to, delta: l.quantity },
    ])
}

/**
 * Contagem: compara o contado com o saldo esperado e gera uma linha por diferença.
 * Categorias não contadas (undefined) não mudam.
 */
export function entriesCount(
  pastureId: string,
  counted: Quantities,
  balances: Map<string, number>,
  reasons: Partial<Record<CategoryId, CountReason>>,
): MovementEntry[] {
  const out: MovementEntry[] = []
  for (const [cat, n] of Object.entries(counted) as [CategoryId, number][]) {
    if (n === undefined || n < 0) continue
    const delta = n - balanceOf(balances, pastureId, cat)
    if (delta !== 0) out.push({ pastureId, category: cat, delta, reason: reasons[cat] ?? 'erro-contagem' })
  }
  return out
}

/**
 * Especificação: o gado de um sexo foi contado como "a especificar" e agora foi contado por categoria.
 * - categorias contadas passam a ter o valor contado;
 * - categorias em branco (undefined) não mudam;
 * - o "a especificar" daquele sexo vai a zero.
 * Retorna as linhas e a diferença (total contado − total que havia nas categorias envolvidas).
 */
export function entriesSpecify(
  pastureId: string,
  sex: Sex,
  counted: Quantities,
  balances: Map<string, number>,
): { entries: MovementEntry[]; difference: number } {
  const entries: MovementEntry[] = []
  const unspec = UNSPECIFIED[sex]
  const pending = balanceOf(balances, pastureId, unspec)
  if (pending > 0) entries.push({ pastureId, category: unspec, delta: -pending, reason: 'especificacao' })
  let difference = -pending
  for (const c of CATEGORIES) {
    if (c.sex !== sex || c.unspecified) continue
    const n = counted[c.id]
    if (n === undefined || n < 0) continue
    const delta = n - balanceOf(balances, pastureId, c.id)
    difference += delta
    if (delta !== 0) entries.push({ pastureId, category: c.id, delta, reason: 'especificacao' })
  }
  return { entries, difference }
}

/** Quantidade "a especificar" por pasto (só pastos com pendência). */
export function pendingSpecification(balances: Map<string, number>, pastureIds: readonly string[]) {
  const out: { pastureId: string; females: number; males: number }[] = []
  for (const id of pastureIds) {
    const females = balanceOf(balances, id, UNSPECIFIED.F)
    const males = balanceOf(balances, id, UNSPECIFIED.M)
    if (females > 0 || males > 0) out.push({ pastureId: id, females, males })
  }
  return out
}

// ------------------------------------------------------------------ gravação

export interface MovementInput {
  type: Exclude<MovementType, 'estorno'>
  date: string
  entries: MovementEntry[]
  notes: string
  /** Preenchido só quando a movimentação é gerada por uma venda. */
  saleId?: string
  /** Especificação com diferença: motivo da diferença. */
  differenceReason?: CountReason | null
}

function validateShape(input: MovementInput): void {
  const { type, entries } = input
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new HerdError('Informe a data.')
  if (input.date > todayLocal()) throw new HerdError('A data não pode ser no futuro.')
  if (entries.length === 0) throw new HerdError('Informe ao menos uma quantidade.')
  for (const e of entries) {
    if (!Number.isInteger(e.delta) || e.delta === 0) throw new HerdError('Quantidades devem ser números inteiros.')
    if (Math.abs(e.delta) > 100_000) throw new HerdError('Quantidade muito alta. Confira o número digitado.')
    if (!isCategoryId(e.category)) throw new HerdError('Categoria inválida.')
  }
  const pastures = new Set(entries.map((e) => e.pastureId))
  switch (type) {
    case 'nascimento':
      if (entries.some((e) => e.delta < 0 || !NEWBORN_CATEGORIES.includes(e.category)))
        throw new HerdError('Nascimento só pode somar bezerros e bezerras.')
      break
    case 'compra':
      if (entries.some((e) => e.delta < 0)) throw new HerdError('Compra só pode somar animais.')
      break
    case 'morte':
    case 'venda':
      if (entries.some((e) => e.delta > 0)) throw new HerdError('Esta movimentação só pode tirar animais.')
      break
    case 'transferencia': {
      if (pastures.size !== 2) throw new HerdError('Escolha pastos de origem e destino diferentes.')
      const sum = new Map<CategoryId, number>()
      for (const e of entries) sum.set(e.category, (sum.get(e.category) ?? 0) + e.delta)
      if ([...sum.values()].some((v) => v !== 0)) throw new HerdError('Transferência inconsistente.')
      break
    }
    case 'mudanca-categoria': {
      if (entries.length % 2 !== 0) throw new HerdError('Mudança de categoria inconsistente.')
      for (let i = 0; i < entries.length; i += 2) {
        const out = entries[i]
        const into = entries[i + 1]
        if (out.delta >= 0 || into.delta !== -out.delta) throw new HerdError('Mudança de categoria inconsistente.')
        if (!laterCategories(out.category).some((c) => c.id === into.category)) {
          throw new HerdError(
            `${category(out.category).label} só pode mudar para uma categoria posterior do mesmo sexo.`,
          )
        }
      }
      break
    }
    case 'especificacao': {
      if (pastures.size !== 1) throw new HerdError('A especificação é feita em um pasto por vez.')
      const sexes = new Set(entries.map((e) => category(e.category).sex))
      if (sexes.size !== 1) throw new HerdError('Especifique fêmeas e machos separadamente.')
      const out = entries.find((e) => isUnspecified(e.category))
      if (!out || out.delta >= 0) throw new HerdError('Não há gado a especificar neste pasto.')
      if (entries.some((e) => isUnspecified(e.category) && e !== out)) throw new HerdError('Especificação inconsistente.')
      if (entries.some((e) => e.reason !== 'especificacao')) throw new HerdError('Especificação inconsistente.')
      if (!entries.some((e) => !isUnspecified(e.category) && e.delta > 0)) throw new HerdError('Informe quantos animais há em cada categoria.')
      const net = entries.reduce((a, e) => a + e.delta, 0)
      if (net !== 0) {
        const r = input.differenceReason
        if (!r || !(r in COUNT_REASONS) || r === 'especificacao' || r === 'saldo-inicial')
          throw new HerdError('O total contado é diferente do que havia: informe o motivo da diferença.')
        if (r === 'morte-nao-registrada' && net > 0) throw new HerdError('"Mortes não registradas" vale só quando o total diminuiu.')
        if (r === 'nascimento-nao-registrado' && net < 0) throw new HerdError('"Nascimentos não registrados" vale só quando o total aumentou.')
      }
      break
    }
    case 'contagem':
      if (entries.some((e) => e.reason === 'especificacao')) throw new HerdError('Use "Especificar contagem" para separar o gado a especificar.')
      if (pastures.size !== 1) throw new HerdError('A contagem é feita em um pasto por vez.')
      if (entries.some((e) => !e.reason || !(e.reason in COUNT_REASONS))) throw new HerdError('Informe o motivo de cada diferença.')
      if (entries.some((e) => e.reason === 'nascimento-nao-registrado' && (e.delta < 0 || !NEWBORN_CATEGORIES.includes(e.category))))
        throw new HerdError('"Nascimentos não registrados" vale só para aumento de bezerros/bezerras.')
      if (entries.some((e) => e.reason === 'morte-nao-registrada' && e.delta > 0))
        throw new HerdError('"Mortes não registradas" vale só para diminuição.')
      break
  }
}

/** Garante que nenhum pasto/categoria fique com saldo negativo. */
function assertNoNegative(balances: Map<string, number>, entries: readonly MovementEntry[], pastureNames: Map<string, string>) {
  const after = new Map<string, number>()
  for (const e of entries) {
    const k = balanceKey(e.pastureId, e.category)
    after.set(k, (after.get(k) ?? balances.get(k) ?? 0) + e.delta)
  }
  for (const [k, v] of after) {
    if (v < 0) {
      const [p, c] = k.split('|') as [string, CategoryId]
      const have = balances.get(k) ?? 0
      throw new HerdError(
        `Saldo insuficiente: ${pastureNames.get(p) ?? 'pasto'} tem ${have} ${category(c).plural.toLowerCase()}.`,
      )
    }
  }
}

function tables(db: ArgoDatabase) {
  return [db.movements, db.pastures, db.auditLog, db.outbox, db.meta]
}

/**
 * Registra uma movimentação, validando tudo dentro de uma única transação.
 * @param idempotencyKey id gerado ao abrir o formulário (evita lançamento duplicado).
 */
export async function recordMovement(db: ArgoDatabase, input: MovementInput, idempotencyKey?: string): Promise<Movement> {
  const repo = new Repository(db, 'movements')
  return db.transaction('rw', tables(db), async () => {
    if (idempotencyKey) {
      const existing = await db.movements.get(idempotencyKey)
      if (existing) return existing
    }
    validateShape(input)
    const pastureIds = [...new Set(input.entries.map((e) => e.pastureId))]
    const pastures = await db.pastures.bulkGet(pastureIds)
    if (pastures.some((p) => !p || p.deletedAt !== null)) throw new HerdError('Pasto não encontrado ou arquivado.')
    const farmIds = new Set(pastures.map((p) => p!.farmId))
    if (farmIds.size !== 1) throw new HerdError('Uma movimentação não pode envolver pastos de fazendas diferentes.')
    const farmId = pastures[0]!.farmId
    const names = new Map(pastures.map((p) => [p!.id, p!.name]))
    assertNoNegative(computeBalances(await db.movements.toArray()), input.entries, names)
    return repo.create(
      {
        farmId,
        type: input.type,
        date: input.date,
        entries: input.entries,
        pastureIds,
        notes: input.notes.trim(),
        reversalOf: null,
        reversedBy: null,
        saleId: input.saleId ?? null,
        ...(input.type === 'especificacao'
          ? { difference: input.entries.reduce((a, e) => a + e.delta, 0), differenceReason: input.differenceReason ?? null }
          : {}),
      },
      idempotencyKey,
    )
  })
}

/** Estorna uma movimentação: lança o inverso e marca a original como estornada. */
export async function reverseMovement(
  db: ArgoDatabase,
  id: string,
  notes: string,
  opts: { fromSale?: boolean } = {},
): Promise<Movement> {
  const repo = new Repository(db, 'movements')
  return db.transaction('rw', tables(db), async () => {
    const original = await db.movements.get(id)
    if (!original) throw new HerdError('Movimentação não encontrada.')
    if (original.type === 'estorno') throw new HerdError('Um estorno não pode ser estornado.')
    if (original.reversedBy) throw new HerdError('Esta movimentação já foi estornada.')
    if (original.saleId && !opts.fromSale)
      throw new HerdError('Esta saída foi gerada por uma venda. Para desfazer, cancele a venda.')
    const entries = original.entries.map((e) => ({ ...e, delta: -e.delta }))
    const pastures = await db.pastures.bulkGet(original.pastureIds)
    const names = new Map(pastures.filter(Boolean).map((p) => [p!.id, p!.name]))
    try {
      assertNoNegative(computeBalances(await db.movements.toArray()), entries, names)
    } catch (e) {
      throw new HerdError(
        `Não é possível estornar: ${(e as Error).message} Os animais já foram movimentados depois deste lançamento.`,
      )
    }
    const reversal = await repo.create({
      farmId: original.farmId,
      type: 'estorno',
      date: todayLocal(),
      entries,
      pastureIds: original.pastureIds,
      notes: notes.trim(),
      reversalOf: original.id,
      reversedBy: null,
      saleId: original.saleId ?? null,
    })
    await repo.update(original.id, { reversedBy: reversal.id })
    return reversal
  })
}

// ------------------------------------------------------------------ utilidades

/** Data de hoje no fuso do aparelho (AAAA-MM-DD). */
export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDay(date: string): string {
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

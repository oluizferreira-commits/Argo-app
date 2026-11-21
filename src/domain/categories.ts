/**
 * Categorias do rebanho, conforme o manejo da fazenda:
 *   Bezerro → Desmama macho → Garrote → Boi (ou Reprodutor)
 *   Bezerra → Desmama fêmea → Novilha → Vaca
 * Os ids são gravados no banco: NUNCA renomeie um id existente (só o `label`).
 *
 * "Fêmeas/Machos (a especificar)": contagem feita sem separar por categoria. Ficam com alerta
 * até serem especificados (movimentação "Especificar contagem").
 */
export type Sex = 'M' | 'F'

export const CATEGORY_IDS = ['bezerro', 'bezerra', 'desmama-macho', 'desmama-femea', 'garrote', 'novilha', 'boi', 'vaca', 'reprodutor', 'femea-a-especificar', 'macho-a-especificar'] as const

export type CategoryId = (typeof CATEGORY_IDS)[number]

export interface Category {
  id: CategoryId
  label: string
  plural: string
  sex: Sex
  /** Posição na sequência de crescimento (0 = recém-nascido; -1 = a especificar). */
  stage: number
  /** Contagem sem categoria definida (precisa ser especificada). */
  unspecified?: boolean
}

export const CATEGORIES: readonly Category[] = [
  { id: 'bezerro', label: 'Bezerro', plural: 'Bezerros', sex: 'M', stage: 0 },
  { id: 'desmama-macho', label: 'Desmama macho', plural: 'Desmama macho', sex: 'M', stage: 1 },
  { id: 'garrote', label: 'Garrote', plural: 'Garrotes', sex: 'M', stage: 2 },
  { id: 'boi', label: 'Boi', plural: 'Bois', sex: 'M', stage: 3 },
  { id: 'reprodutor', label: 'Reprodutor', plural: 'Reprodutores', sex: 'M', stage: 3 },
  { id: 'macho-a-especificar', label: 'Machos (a especificar)', plural: 'Machos (a especificar)', sex: 'M', stage: -1, unspecified: true },
  { id: 'bezerra', label: 'Bezerra', plural: 'Bezerras', sex: 'F', stage: 0 },
  { id: 'desmama-femea', label: 'Desmama fêmea', plural: 'Desmama fêmea', sex: 'F', stage: 1 },
  { id: 'novilha', label: 'Novilha', plural: 'Novilhas', sex: 'F', stage: 2 },
  { id: 'vaca', label: 'Vaca', plural: 'Vacas', sex: 'F', stage: 3 },
  { id: 'femea-a-especificar', label: 'Fêmeas (a especificar)', plural: 'Fêmeas (a especificar)', sex: 'F', stage: -1, unspecified: true },
]

export const UNSPECIFIED: Record<Sex, CategoryId> = { M: 'macho-a-especificar', F: 'femea-a-especificar' }

export function isUnspecified(id: CategoryId): boolean {
  return category(id).unspecified === true
}

/** Categorias definidas (sem as "a especificar"). */
export const SPECIFIC_CATEGORIES = CATEGORIES.filter((c) => !c.unspecified)

export const MALE_CATEGORIES = CATEGORIES.filter((c) => c.sex === 'M')
export const FEMALE_CATEGORIES = CATEGORIES.filter((c) => c.sex === 'F')
export const NEWBORN_CATEGORIES: readonly CategoryId[] = ['bezerro', 'bezerra']

export function category(id: CategoryId): Category {
  const c = CATEGORIES.find((x) => x.id === id)
  if (!c) throw new Error(`Categoria desconhecida: ${id}`)
  return c
}

export function isCategoryId(v: unknown): v is CategoryId {
  return typeof v === 'string' && (CATEGORY_IDS as readonly string[]).includes(v)
}

/**
 * Categorias para as quais um animal pode mudar: mesmo sexo, fase posterior.
 * "A especificar" não muda de categoria por aqui: usa "Especificar contagem".
 */
export function laterCategories(id: CategoryId): Category[] {
  const c = category(id)
  if (c.unspecified) return []
  return CATEGORIES.filter((x) => !x.unspecified && x.sex === c.sex && x.stage > c.stage)
}

/** Próxima categoria natural (sugestão padrão), ou null se já é adulto. */
export function nextCategory(id: CategoryId): CategoryId | null {
  return laterCategories(id).sort((a, b) => a.stage - b.stage)[0]?.id ?? null
}

/**
 * Categorias do rebanho, conforme o manejo da fazenda:
 *   Bezerro → Desmama macho → Garrote → Boi
 *   Bezerra → Desmama fêmea → Novilha → Vaca
 * Os ids são gravados no banco: NUNCA renomeie um id existente (só o `label`).
 */
export type Sex = 'M' | 'F'

export const CATEGORY_IDS = ['bezerro', 'bezerra', 'desmama-macho', 'desmama-femea', 'garrote', 'novilha', 'boi', 'vaca'] as const

export type CategoryId = (typeof CATEGORY_IDS)[number]

export interface Category {
  id: CategoryId
  label: string
  plural: string
  sex: Sex
  /** Posição na sequência de crescimento (0 = recém-nascido). */
  stage: number
}

export const CATEGORIES: readonly Category[] = [
  { id: 'bezerro', label: 'Bezerro', plural: 'Bezerros', sex: 'M', stage: 0 },
  { id: 'desmama-macho', label: 'Desmama macho', plural: 'Desmama macho', sex: 'M', stage: 1 },
  { id: 'garrote', label: 'Garrote', plural: 'Garrotes', sex: 'M', stage: 2 },
  { id: 'boi', label: 'Boi', plural: 'Bois', sex: 'M', stage: 3 },
  { id: 'bezerra', label: 'Bezerra', plural: 'Bezerras', sex: 'F', stage: 0 },
  { id: 'desmama-femea', label: 'Desmama fêmea', plural: 'Desmama fêmea', sex: 'F', stage: 1 },
  { id: 'novilha', label: 'Novilha', plural: 'Novilhas', sex: 'F', stage: 2 },
  { id: 'vaca', label: 'Vaca', plural: 'Vacas', sex: 'F', stage: 3 },
]

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

/** Categorias para as quais um animal pode mudar: mesmo sexo, fase posterior. */
export function laterCategories(id: CategoryId): Category[] {
  const c = category(id)
  return CATEGORIES.filter((x) => x.sex === c.sex && x.stage > c.stage)
}

/** Próxima categoria natural (sugestão padrão), ou null se já é adulto. */
export function nextCategory(id: CategoryId): CategoryId | null {
  return laterCategories(id).sort((a, b) => a.stage - b.stage)[0]?.id ?? null
}

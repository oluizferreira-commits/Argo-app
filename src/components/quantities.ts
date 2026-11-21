import type { CategoryId } from '../domain/categories'

export type QtyText = Partial<Record<CategoryId, string>>

/** Converte os textos dos campos em quantidades numéricas (> 0). */
export function toQuantities(v: QtyText): Partial<Record<CategoryId, number>> {
  const out: Partial<Record<CategoryId, number>> = {}
  for (const [k, t] of Object.entries(v) as [CategoryId, string][]) {
    const n = Number(t)
    if (t !== '' && Number.isInteger(n) && n > 0) out[k] = n
  }
  return out
}

export function sumQty(v: QtyText): number {
  return Object.values(toQuantities(v)).reduce((a, b) => a + (b ?? 0), 0)
}

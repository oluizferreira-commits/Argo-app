import type { Movement, Pasture } from '../../db/types'
import { category } from '../../domain/categories'

/** Texto curto que descreve uma movimentação (ex.: "+12 · Pasto Grande"). */
export function describeMovement(m: Movement, pastures: Map<string, Pasture>): string {
  const name = (id: string) => pastures.get(id)?.name ?? 'pasto removido'
  const total = m.entries.filter((e) => e.delta > 0).reduce((a, e) => a + e.delta, 0)
  const out = m.entries.filter((e) => e.delta < 0).reduce((a, e) => a - e.delta, 0)
  switch (m.type) {
    case 'transferencia':
    case 'mudanca-categoria': {
      const from = m.entries.find((e) => e.delta < 0)
      const to = m.entries.find((e) => e.delta > 0)
      const where = from && to && from.pastureId !== to.pastureId ? ` · ${name(from.pastureId)} → ${name(to.pastureId)}` : from ? ` · ${name(from.pastureId)}` : ''
      if (m.type === 'mudanca-categoria' && from && to)
        return `${total} ${category(from.category).plural.toLowerCase()} → ${category(to.category).label.toLowerCase()}${where}`
      return `${total} cab.${where}`
    }
    case 'contagem': {
      const net = total - out
      return `${net >= 0 ? '+' : ''}${net} cab. · ${name(m.pastureIds[0])}`
    }
    default:
      return `${total ? `+${total}` : `−${out}`} cab. · ${m.pastureIds.map(name).join(', ')}`
  }
}

/** Ordena: data do fato (mais recente primeiro), depois hora do lançamento. */
export function sortMovements(list: readonly Movement[]): Movement[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

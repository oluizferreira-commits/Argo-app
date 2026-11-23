import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../../db/database'
import { category } from '../../domain/categories'
import { useFarm } from '../fazendas/FarmContext'
import { computeBalances } from '../rebanho/herd'
import type { ShapeView } from './layers'
import { loadMapData } from './mapping'

/**
 * Dados do ARGO Maps: desenhos, situação do mapeamento, pastos do cadastro e cabeças por pasto.
 * As cabeças vêm sempre do Rebanho (nunca são guardadas no mapa).
 */
export function useMapData() {
  const { farm } = useFarm()
  const data = useLiveQuery(async () => {
    const [map, pastures, movements] = await Promise.all([
      loadMapData(db, farm.id),
      db.pastures.where('farmId').equals(farm.id).toArray(),
      db.movements.where('farmId').equals(farm.id).toArray(),
    ])
    return { ...map, pastures: pastures.filter((p) => p.deletedAt === null), movements }
  }, [farm.id])

  return useMemo(() => {
    if (!data) return undefined
    const balances = computeBalances(data.movements)
    const heads = new Map<string, number>()
    const cats = new Map<string, { label: string; n: number }[]>()
    for (const [k, v] of balances) {
      if (v <= 0) continue
      const [pid, cat] = k.split('|')
      heads.set(pid, (heads.get(pid) ?? 0) + v)
      cats.set(pid, [...(cats.get(pid) ?? []), { label: category(cat as never).plural, n: v }])
    }
    const pastureById = new Map(data.pastures.map((p) => [p.id, p]))
    const views: ShapeView[] = data.shapes.map((shape) => ({
      shape,
      label: shape.kind === 'pasto' ? (pastureById.get(shape.pastureId ?? '')?.name ?? 'Pasto removido') : shape.kind === 'perimetro' ? 'Perímetro' : shape.name,
      heads: shape.kind === 'pasto' ? (heads.get(shape.pastureId ?? '') ?? 0) : null,
    }))
    return { ...data, views, heads, cats, pastureById }
  }, [data])
}

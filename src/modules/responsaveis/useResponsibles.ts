import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import type { Responsible } from '../../db/types'
import { useFarm } from '../fazendas/FarmContext'

/** Responsáveis da fazenda (ativos primeiro, depois por nome). */
export function useResponsibles(): Responsible[] | undefined {
  const { farm } = useFarm()
  return useLiveQuery(async () => {
    const all = (await db.responsibles.where('farmId').equals(farm.id).toArray()).filter((r) => r.deletedAt === null)
    return all.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'))
  }, [farm.id])
}

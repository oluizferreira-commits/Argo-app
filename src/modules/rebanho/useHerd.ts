import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../../db/database'
import type { Movement, Pasture, PastureTask } from '../../db/types'
import { useFarm } from '../fazendas/FarmContext'
import { computeBalances } from './herd'

const EMPTY_P: Pasture[] = []
const EMPTY_M: Movement[] = []

/** Pastos ativos da fazenda aberta, em ordem alfabética. */
export function usePastures(): Pasture[] | undefined {
  const { farm } = useFarm()
  return useLiveQuery(async () => {
    const all = await db.pastures.where('farmId').equals(farm.id).toArray()
    return all.filter((p) => p.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
  }, [farm.id])
}

/** Movimentações da fazenda aberta. */
export function useMovements(): Movement[] | undefined {
  const { farm } = useFarm()
  return useLiveQuery(() => db.movements.where('farmId').equals(farm.id).toArray(), [farm.id])
}

/** Serviços pendentes da fazenda aberta, por pasto. */
export function usePendingTasks(): Map<string, number> | undefined {
  const { farm } = useFarm()
  return useLiveQuery(async () => {
    const map = new Map<string, number>()
    for (const t of await db.pastureTasks.where('farmId').equals(farm.id).toArray())
      if (t.deletedAt === null && !t.done) map.set(t.pastureId, (map.get(t.pastureId) ?? 0) + 1)
    return map
  }, [farm.id])
}

/** Serviços pendentes da fazenda aberta (mais antigos primeiro). */
export function usePendingTaskList(): PastureTask[] | undefined {
  const { farm } = useFarm()
  return useLiveQuery(async () => {
    const all = await db.pastureTasks.where('farmId').equals(farm.id).toArray()
    return all.filter((t) => t.deletedAt === null && !t.done).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [farm.id])
}

/** Saldos atuais (recalculados automaticamente a cada lançamento). */
export function useBalances() {
  const movements = useMovements()
  const balances = useMemo(() => computeBalances(movements ?? EMPTY_M), [movements])
  return { balances, ready: movements !== undefined }
}

export function usePastureMap() {
  const all = useLiveQuery(() => db.pastures.toArray()) ?? EMPTY_P
  return useMemo(() => new Map(all.map((p) => [p.id, p])), [all])
}

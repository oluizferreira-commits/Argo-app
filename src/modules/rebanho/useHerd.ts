import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../../db/database'
import type { Movement, Pasture } from '../../db/types'
import { computeBalances } from './herd'

const EMPTY_P: Pasture[] = []
const EMPTY_M: Movement[] = []

/** Pastos ativos, em ordem alfabética. */
export function usePastures(): Pasture[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.pastures.toArray()
    return all.filter((p) => p.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
  })
}

export function useMovements(): Movement[] | undefined {
  return useLiveQuery(() => db.movements.toArray())
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

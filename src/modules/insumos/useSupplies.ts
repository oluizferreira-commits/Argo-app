import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { db } from '../../db/database'
import type { Supply, SupplyMovement } from '../../db/types'
import { useFarm } from '../fazendas/FarmContext'
import { ensureDefaultSupplies, isMixture, supplyStock } from './supplies'

export interface SupplyRow {
  supply: Supply
  halves: number
}

/** Produtos da fazenda com o estoque atual (cria Sal branco e Sal mineral na primeira vez). */
export function useSupplies(): { rows: SupplyRow[]; movements: SupplyMovement[] } | undefined {
  const { farm } = useFarm()
  useEffect(() => {
    void ensureDefaultSupplies(db, farm.id)
  }, [farm.id])
  return useLiveQuery(async () => {
    const supplies = (await db.supplies.where('farmId').equals(farm.id).toArray()).filter((s) => s.deletedAt === null)
    const movements = await db.supplyMovements.where('farmId').equals(farm.id).toArray()
    const rows = supplies
      // mistura primeiro (é o que vai para o cocho), depois ativos por nome
      .sort((a, b) => Number(b.active) - Number(a.active) || Number(isMixture(b)) - Number(isMixture(a)) || a.name.localeCompare(b.name, 'pt-BR'))
      .map((supply) => ({ supply, halves: supplyStock(movements, supply.id) }))
    return { rows, movements }
  }, [farm.id])
}

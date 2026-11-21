import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import type { Equipment, FuelMovement } from '../../db/types'
import { useFarm } from '../fazendas/FarmContext'

/** Equipamentos da fazenda (ativos primeiro, depois por nome). */
export function useEquipments(): Equipment[] | undefined {
  const { farm } = useFarm()
  return useLiveQuery(async () => {
    const all = (await db.equipments.where('farmId').equals(farm.id).toArray()).filter((e) => e.deletedAt === null)
    return all.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
  }, [farm.id])
}

/** Lançamentos de diesel da fazenda. */
export function useFuelMovements(): FuelMovement[] | undefined {
  const { farm } = useFarm()
  return useLiveQuery(async () => (await db.fuelMovements.where('farmId').equals(farm.id).toArray()).filter((m) => m.deletedAt === null), [farm.id])
}

import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../../db/database'
import { useFarm } from '../fazendas/FarmContext'

/** Tudo o que o manejo usa, numa consulta reativa (atualiza a cada lançamento). */
export function useManejo() {
  const { farm } = useFarm()
  const data = useLiveQuery(async () => {
    const f = farm.id
    const [operations, supplies, supplyMovements, equipments, responsibles, pastures, fuelMovements] = await Promise.all([
      db.fieldOperations.where('farmId').equals(f).toArray(),
      db.supplies.where('farmId').equals(f).toArray(),
      db.supplyMovements.where('farmId').equals(f).toArray(),
      db.equipments.where('farmId').equals(f).toArray(),
      db.responsibles.where('farmId').equals(f).toArray(),
      db.pastures.where('farmId').equals(f).toArray(),
      db.fuelMovements.where('farmId').equals(f).toArray(),
    ])
    return { operations, supplies, supplyMovements, equipments, responsibles, pastures, fuelMovements }
  }, [farm.id])
  return useMemo(() => {
    if (!data) return undefined
    return {
      ...data,
      operations: data.operations.filter((o) => o.deletedAt === null).sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number),
      pastureById: new Map(data.pastures.map((p) => [p.id, p])),
      equipmentById: new Map(data.equipments.map((e) => [e.id, e])),
      personById: new Map(data.responsibles.map((r) => [r.id, r.name])),
      supplyById: new Map(data.supplies.map((s) => [s.id, s])),
    }
  }, [data])
}
export type ManejoData = NonNullable<ReturnType<typeof useManejo>>

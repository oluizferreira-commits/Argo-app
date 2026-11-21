import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { nowIso } from '../../core/ids'
import { db } from '../../db/database'
import type { Equipment } from '../../db/types'
import { useFarm } from '../fazendas/FarmContext'
import { meterAt, type MeterContext } from './machines'

/** Máquinas e tudo que alimenta o horímetro, numa consulta reativa. */
export function useMaquinas() {
  const { farm } = useFarm()
  const data = useLiveQuery(async () => {
    const f = farm.id
    const [equipments, sessions, fuel, operations, adjustments, responsibles, pastures, plans, records, checklists, supplies, supplyMovements] = await Promise.all([
      db.equipments.where('farmId').equals(f).toArray(),
      db.machineSessions.where('farmId').equals(f).toArray(),
      db.fuelMovements.where('farmId').equals(f).toArray(),
      db.fieldOperations.where('farmId').equals(f).toArray(),
      db.meterAdjustments.where('farmId').equals(f).toArray(),
      db.responsibles.where('farmId').equals(f).toArray(),
      db.pastures.where('farmId').equals(f).toArray(),
      db.maintenancePlans.where('farmId').equals(f).toArray(),
      db.maintenanceRecords.where('farmId').equals(f).toArray(),
      db.machineChecklists.where('farmId').equals(f).toArray(),
      db.supplies.where('farmId').equals(f).toArray(),
      db.supplyMovements.where('farmId').equals(f).toArray(),
    ])
    return { equipments, sessions, fuel, operations, adjustments, responsibles, pastures, plans, records, checklists, supplies, supplyMovements }
  }, [farm.id])
  return useMemo(() => {
    if (!data) return undefined
    const ctx: MeterContext = { sessions: data.sessions, fuel: data.fuel, operations: data.operations, adjustments: data.adjustments }
    return {
      ...data,
      ctx,
      equipments: data.equipments.filter((e) => e.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })),
      meterOf: (e: Equipment) => meterAt(e, ctx),
      personById: new Map(data.responsibles.map((r) => [r.id, r.name])),
      pastureById: new Map(data.pastures.map((p) => [p.id, p])),
      equipmentById: new Map(data.equipments.map((e) => [e.id, e])),
    }
  }, [data])
}
export type MaquinasData = NonNullable<ReturnType<typeof useMaquinas>>

/** Relógio para mostrar o tempo decorrido (o cálculo usa os horários gravados, não este relógio). */
export function useNow(active: boolean, ms = 1000): string {
  const [now, setNow] = useState(nowIso)
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(nowIso()), ms)
    const onVisible = () => setNow(nowIso())
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, ms])
  return now
}

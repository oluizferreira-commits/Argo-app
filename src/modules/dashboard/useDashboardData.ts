import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../../db/database'
import { useFarm } from '../fazendas/FarmContext'
import { todayLocal } from '../rebanho/herd'
import { computeAgenda, computeIndicators, computePendencies, recentActivities, type DashboardData } from './dashboard'

/**
 * Dados do Painel numa única consulta reativa (atualiza sozinha a cada lançamento).
 * Histórico: só as últimas alterações (índice por data), não o histórico inteiro.
 */
export function useDashboardData() {
  const { farm } = useFarm()
  const data = useLiveQuery(async (): Promise<DashboardData> => {
    const f = farm.id
    const [pastures, movements, sales, payments, clients, reserveEntries, supplies, supplyMovements, fuelMovements, equipments, tasks, vaccinations, vaccinationApplications, responsibles, maintenancePlans, maintenanceRecords, machineChecklists, machineSessions, meterAdjustments, fieldOperations, workerPayments, audit] = await Promise.all([
      db.pastures.where('farmId').equals(f).toArray(),
      db.movements.where('farmId').equals(f).toArray(),
      db.sales.where('farmId').equals(f).toArray(),
      db.payments.where('farmId').equals(f).toArray(),
      db.clients.where('farmId').equals(f).toArray(),
      db.reserveEntries.where('farmId').equals(f).toArray(),
      db.supplies.where('farmId').equals(f).toArray(),
      db.supplyMovements.where('farmId').equals(f).toArray(),
      db.fuelMovements.where('farmId').equals(f).toArray(),
      db.equipments.where('farmId').equals(f).toArray(),
      db.pastureTasks.where('farmId').equals(f).toArray(),
      db.vaccinations.where('farmId').equals(f).toArray(),
      db.vaccinationApplications.where('farmId').equals(f).toArray(),
      db.responsibles.where('farmId').equals(f).toArray(),
      db.maintenancePlans.where('farmId').equals(f).toArray(),
      db.maintenanceRecords.where('farmId').equals(f).toArray(),
      db.machineChecklists.where('farmId').equals(f).toArray(),
      db.machineSessions.where('farmId').equals(f).toArray(),
      db.meterAdjustments.where('farmId').equals(f).toArray(),
      db.fieldOperations.where('farmId').equals(f).toArray(),
      db.workerPayments.where('farmId').equals(f).toArray(),
      db.auditLog.orderBy('at').reverse().limit(80).toArray(),
    ])
    return { farm, pastures, movements, sales, payments, clients, reserveEntries, supplies, supplyMovements, fuelMovements, equipments, tasks, vaccinations, vaccinationApplications, responsibles, maintenancePlans, maintenanceRecords, machineChecklists, machineSessions, meterAdjustments, fieldOperations, workerPayments, audit }
  }, [farm])

  return useMemo(() => {
    if (!data) return undefined
    const today = todayLocal()
    const indicators = computeIndicators(data, today)
    return {
      indicators,
      pendencies: computePendencies(data, today, indicators),
      agenda: computeAgenda(data, today),
      activities: recentActivities(data.audit, data),
      today,
    }
  }, [data])
}

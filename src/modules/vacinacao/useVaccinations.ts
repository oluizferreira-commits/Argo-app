import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../../db/database'
import type { Pasture, Responsible, Vaccination, VaccinationApplication } from '../../db/types'
import { useFarm } from '../fazendas/FarmContext'
import { coverage, type Coverage } from './vaccination'

export interface VaccinationRow {
  v: Vaccination
  cov: Coverage
  pasture: Pasture | undefined
  apps: VaccinationApplication[]
}

/** Campanhas de vacinação da fazenda com a cobertura de cada uma (atualiza sozinho). */
export function useVaccinations() {
  const { farm } = useFarm()
  const data = useLiveQuery(async () => {
    const [vaccinations, apps, pastures, responsibles] = await Promise.all([
      db.vaccinations.where('farmId').equals(farm.id).toArray(),
      db.vaccinationApplications.where('farmId').equals(farm.id).toArray(),
      db.pastures.where('farmId').equals(farm.id).toArray(),
      db.responsibles.where('farmId').equals(farm.id).toArray(),
    ])
    return { vaccinations, apps, pastures, responsibles }
  }, [farm.id])
  return useMemo(() => {
    if (!data) return undefined
    const pastures = new Map(data.pastures.map((p) => [p.id, p]))
    const rows: VaccinationRow[] = data.vaccinations
      .filter((v) => v.deletedAt === null)
      .map((v) => ({
        v,
        cov: coverage(v, data.apps),
        pasture: pastures.get(v.pastureId),
        apps: data.apps.filter((a) => a.vaccinationId === v.id && a.deletedAt === null).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      }))
    // em andamento primeiro; depois a aplicação mais recente
    const last = (r: VaccinationRow) => r.apps.find((a) => a.status === 'ativo')?.date ?? r.v.createdAt.slice(0, 10)
    rows.sort((a, b) => Number(b.cov.pending > 0) - Number(a.cov.pending > 0) || last(b).localeCompare(last(a)))
    return { rows, responsibles: new Map<string, Responsible>(data.responsibles.map((r) => [r.id, r])) }
  }, [data])
}

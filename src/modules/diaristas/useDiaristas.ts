import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { useFarm } from '../fazendas/FarmContext'

/** Diaristas, diárias e pagamentos da fazenda (atualiza sozinho). */
export function useDiaristas() {
  const { farm } = useFarm()
  return useLiveQuery(async () => {
    const f = farm.id
    const [workers, days, payments] = await Promise.all([
      db.workers.where('farmId').equals(f).toArray(),
      db.workDays.where('farmId').equals(f).toArray(),
      db.workerPayments.where('farmId').equals(f).toArray(),
    ])
    return {
      workers: workers.filter((w) => w.deletedAt === null).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR')),
      days,
      payments,
    }
  }, [farm.id])
}

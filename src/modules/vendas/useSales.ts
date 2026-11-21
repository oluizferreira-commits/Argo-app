import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import type { Client, Sale } from '../../db/types'
import { useFarm } from '../fazendas/FarmContext'

/** Clientes ativos da fazenda aberta, em ordem alfabética. */
export function useClients(): Client[] | undefined {
  const { farm } = useFarm()
  return useLiveQuery(async () => {
    const all = await db.clients.where('farmId').equals(farm.id).toArray()
    return all.filter((c) => c.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [farm.id])
}

/** Vendas da fazenda aberta, mais recentes primeiro. */
export function useSales(): Sale[] | undefined {
  const { farm } = useFarm()
  return useLiveQuery(async () => {
    const all = await db.sales.where('farmId').equals(farm.id).toArray()
    return all.sort((a, b) => b.number - a.number)
  }, [farm.id])
}

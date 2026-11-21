import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../../db/database'
import { useFarm } from '../fazendas/FarmContext'
import { reservePendingByPayment, reserveSummary } from './reserve'

/** Situação da reserva financeira da fazenda aberta. */
export function useReserve() {
  const { farm } = useFarm()
  const data = useLiveQuery(async () => {
    const [sales, payments, entries, clients] = await Promise.all([
      db.sales.where('farmId').equals(farm.id).toArray(),
      db.payments.where('farmId').equals(farm.id).toArray(),
      db.reserveEntries.where('farmId').equals(farm.id).toArray(),
      db.clients.where('farmId').equals(farm.id).toArray(),
    ])
    return { sales, payments, entries, clients }
  }, [farm.id])
  return useMemo(() => {
    if (!data) return undefined
    const summary = reserveSummary(data.sales, data.payments, data.entries)
    const byPayment = reservePendingByPayment(data.payments, data.entries)
    const pendingPayments = data.payments
      .map((p) => ({ payment: p, pendingCents: byPayment.get(p.id) ?? 0 }))
      .filter((x) => x.pendingCents > 0)
      .sort((a, b) => a.payment.date.localeCompare(b.payment.date))
    return {
      summary,
      pendingPayments,
      entries: [...data.entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      clients: new Map(data.clients.map((c) => [c.id, c])),
      sales: new Map(data.sales.map((s) => [s.id, s])),
    }
  }, [data])
}

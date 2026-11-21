import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../../db/database'
import type { Client, Payment, Sale } from '../../db/types'
import { useFarm } from '../fazendas/FarmContext'
import { todayLocal } from '../rebanho/herd'
import { saleBalance, type InstallmentState } from './receivables'

export interface OpenInstallment extends InstallmentState {
  sale: Sale
  client: Client | undefined
}

/** Parcelas em aberto da fazenda, com totais (a receber, vencido, recebido no mês). */
export function useReceivables() {
  const { farm } = useFarm()
  const data = useLiveQuery(async () => {
    const [sales, payments, clients] = await Promise.all([
      db.sales.where('farmId').equals(farm.id).toArray(),
      db.payments.where('farmId').equals(farm.id).toArray(),
      db.clients.where('farmId').equals(farm.id).toArray(),
    ])
    return { sales, payments, clients }
  }, [farm.id])

  return useMemo(() => {
    if (!data) return undefined
    const today = todayLocal()
    const month = today.slice(0, 7)
    const byClient = new Map(data.clients.map((c) => [c.id, c]))
    const paymentsBySale = new Map<string, Payment[]>()
    for (const p of data.payments) paymentsBySale.set(p.saleId, [...(paymentsBySale.get(p.saleId) ?? []), p])
    const open: OpenInstallment[] = []
    let openCents = 0
    let overdueCents = 0
    for (const s of data.sales) {
      if (s.status !== 'ativa') continue
      const b = saleBalance(s, paymentsBySale.get(s.id) ?? [], today)
      openCents += b.openCents
      overdueCents += b.overdueCents
      for (const i of b.installments) if (i.openCents > 0) open.push({ ...i, sale: s, client: byClient.get(s.clientId) })
    }
    open.sort((a, b) => Number(b.status === 'vencida') - Number(a.status === 'vencida') || a.due.localeCompare(b.due))
    const receivedThisMonth = data.payments.filter((p) => p.status === 'ativo' && p.date.startsWith(month)).reduce((a, p) => a + p.amountCents, 0)
    return { open, openCents, overdueCents, receivedThisMonth, payments: data.payments, clients: byClient, sales: new Map(data.sales.map((s) => [s.id, s])) }
  }, [data])
}

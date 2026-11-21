import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import type { Payment } from '../../db/types'
import { buildPixPayload } from '../../domain/pix'
import { createFarm, updateFarmPix } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { entriesIn, recordMovement, todayLocal } from '../rebanho/herd'
import { salePixPayload } from '../vendas/receipt'
import { addDays, buildInstallments, cancelSale, createClient, createSale } from '../vendas/sales'
import { recordPayment, reversePayment, saleBalance } from './receivables'

let db: ArgoDatabase
afterEach(async () => db?.delete())

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'Fazenda Teste', responsible: '', city: '' }, '')
  const p = await createPasture(db, farm.id, { name: 'Pasto Teste', areaHa: null, notes: '' })
  await recordMovement(db, { type: 'compra', date: addDays(todayLocal(), -90), notes: '', entries: entriesIn(p.id, { boi: 20 }) })
  const client = await createClient(db, farm.id, { name: 'Cliente Teste', phone: '', city: '', document: '' })
  const sell = (qty: number, priceCents: number, kind: 'avista' | 'prazo' | 'parcelado', date = todayLocal(), extra = {}) =>
    createSale(db, farm.id, {
      date,
      clientId: client.id,
      mode: 'cabeca',
      items: [{ pastureId: p.id, category: 'boi', quantity: qty }],
      weighing: null,
      animals: [],
      pricePerArrobaCents: null,
      pricePerHeadCents: { boi: priceCents },
      paymentKind: kind,
      installments: buildInstallments(kind, date, qty * priceCents, { days: 30, count: 3, intervalDays: 30 }),
      notes: '',
      ...extra,
    })
  const payments = async (saleId: string) => db.payments.where('saleId').equals(saleId).toArray()
  return { farm, p, client, sell, payments }
}

describe('contas a receber', () => {
  it('pagamento parcial e quitação', async () => {
    const { farm, sell, payments } = await setup()
    const s = await sell(1, 300000, 'prazo')
    await recordPayment(db, farm.id, { saleId: s.id, date: todayLocal(), amountCents: 100000, method: 'pix', notes: '' })
    let b = saleBalance(s, await payments(s.id))
    expect(b).toMatchObject({ paidCents: 100000, openCents: 200000, settled: false })
    expect(b.installments[0].status).toBe('parcial')
    await recordPayment(db, farm.id, { saleId: s.id, date: todayLocal(), amountCents: 200000, method: 'dinheiro', notes: '' })
    b = saleBalance(s, await payments(s.id))
    expect(b).toMatchObject({ openCents: 0, settled: true })
    await expect(recordPayment(db, farm.id, { saleId: s.id, date: todayLocal(), amountCents: 1, method: 'pix', notes: '' })).rejects.toThrow(/quitada/)
  })

  it('abate a parcela mais antiga primeiro e marca vencidas', async () => {
    const { farm, sell, payments } = await setup()
    const s = await sell(1, 300000, 'parcelado', addDays(todayLocal(), -45)) // 3 × R$ 1.000: vence -15d, +15d, +45d
    await recordPayment(db, farm.id, { saleId: s.id, date: todayLocal(), amountCents: 50000, method: 'pix', notes: '' })
    const b = saleBalance(s, await payments(s.id))
    expect(b.installments.map((i) => [i.paidCents, i.status])).toEqual([
      [50000, 'vencida'],
      [0, 'aberta'],
      [0, 'aberta'],
    ])
    expect(b.overdueCents).toBe(50000)
  })

  it('não aceita mais que o saldo, data futura ou antes da venda', async () => {
    const { farm, sell } = await setup()
    const s = await sell(1, 100000, 'prazo')
    await expect(recordPayment(db, farm.id, { saleId: s.id, date: todayLocal(), amountCents: 100001, method: 'pix', notes: '' })).rejects.toThrow(/maior que o saldo/)
    await expect(recordPayment(db, farm.id, { saleId: s.id, date: addDays(todayLocal(), 1), amountCents: 100, method: 'pix', notes: '' })).rejects.toThrow(/futuro/)
    await expect(recordPayment(db, farm.id, { saleId: s.id, date: addDays(todayLocal(), -1), amountCents: 100, method: 'pix', notes: '' })).rejects.toThrow(/antes da data da venda/)
  })

  it('estorno devolve o valor ao saldo e fica no histórico', async () => {
    const { farm, sell, payments } = await setup()
    const s = await sell(1, 100000, 'prazo')
    const pay = await recordPayment(db, farm.id, { saleId: s.id, date: todayLocal(), amountCents: 40000, method: 'pix', notes: '' })
    await reversePayment(db, pay.id, 'lançado errado')
    const list = await payments(s.id)
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('estornado')
    expect(saleBalance(s, list).openCents).toBe(100000)
    await expect(reversePayment(db, pay.id, '')).rejects.toThrow(/já foi estornado/)
  })

  it('venda à vista "já recebida" sai quitada; venda com recebimento não é cancelada', async () => {
    const { sell, payments } = await setup()
    const s = await sell(2, 250000, 'avista', todayLocal(), { receivedNow: { method: 'pix' } })
    const list = await payments(s.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ amountCents: 500000, method: 'pix' })
    expect(saleBalance(s, list).settled).toBe(true)
    await expect(cancelSale(db, s.id, '')).rejects.toThrow(/Estorne os recebimentos/)
    await reversePayment(db, list[0].id, '')
    await expect(cancelSale(db, s.id, '')).resolves.toMatchObject({ status: 'cancelada' })
  })

  it('QR Pix cobra só o que falta da parcela; parcela paga não gera QR', async () => {
    const { farm, sell, payments } = await setup()
    const f = await updateFarmPix(db, farm.id, { type: 'cpf', key: '529.982.247-25', name: 'Teste', city: 'Cidade' })
    const s = await sell(1, 100000, 'prazo')
    await recordPayment(db, farm.id, { saleId: s.id, date: todayLocal(), amountCents: 30000, method: 'pix', notes: '' })
    const pix = salePixPayload(s, f, 0, (await payments(s.id)) as Payment[])!
    expect(pix).toContain('5406700.00')
    expect(pix).toBe(buildPixPayload({ key: '52998224725', name: 'Teste', city: 'Cidade', amountCents: 70000, txid: 'ARGO0001' }))
    await recordPayment(db, farm.id, { saleId: s.id, date: todayLocal(), amountCents: 70000, method: 'pix', notes: '' })
    expect(salePixPayload(s, f, 0, await payments(s.id))).toBeNull()
  })
})

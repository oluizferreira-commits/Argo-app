import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { entriesIn, recordMovement, todayLocal } from '../rebanho/herd'
import { recordPayment, reversePayment } from '../receber/receivables'
import { addDays, buildInstallments, createClient, createSale } from '../vendas/sales'
import { pendingForPayment, recordReserveEntry, reservePendingByPayment, reserveShare, reserveSummary, reverseReserveEntry } from './reserve'

let db: ArgoDatabase
afterEach(async () => db?.delete())

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'Fazenda Teste', responsible: '', city: '' }, '')
  const p = await createPasture(db, farm.id, { name: 'Pasto', areaHa: null, notes: '' })
  await recordMovement(db, { type: 'compra', date: addDays(todayLocal(), -10), notes: '', entries: entriesIn(p.id, { boi: 10 }) })
  const c = await createClient(db, farm.id, { name: 'Cliente', phone: '', city: '', document: '' })
  const sale = await createSale(db, farm.id, {
    date: todayLocal(),
    clientId: c.id,
    mode: 'cabeca',
    items: [{ pastureId: p.id, category: 'boi', quantity: 4 }],
    weighing: null,
    animals: [],
    pricePerArrobaCents: null,
    pricePerHeadCents: { boi: 250000 },
    paymentKind: 'prazo',
    installments: buildInstallments('prazo', todayLocal(), 1000000, { days: 30 }),
    notes: '',
  })
  const summary = async () =>
    reserveSummary(
      await db.sales.where('farmId').equals(farm.id).toArray(),
      await db.payments.where('farmId').equals(farm.id).toArray(),
      await db.reserveEntries.where('farmId').equals(farm.id).toArray(),
    )
  const pay = (cents: number) => recordPayment(db, farm.id, { saleId: sale.id, date: todayLocal(), amountCents: cents, method: 'pix', notes: '' })
  return { farm, sale, summary, pay }
}

describe('reserva financeira (35%)', () => {
  it('recebeu R$ 500 → separar R$ 175', () => {
    expect(reserveShare(50000)).toBe(17500)
    expect(reserveShare(1)).toBe(0)
    expect(reserveShare(3)).toBe(1)
  })

  it('meta é 35% da venda; o devido cresce conforme recebe', async () => {
    const { summary, pay } = await setup()
    expect(await summary()).toMatchObject({ targetCents: 350000, dueCents: 0, pendingCents: 0 })
    await pay(50000)
    expect(await summary()).toMatchObject({ dueCents: 17500, pendingCents: 17500 })
    await pay(950000)
    expect(await summary()).toMatchObject({ dueCents: 350000, pendingCents: 350000 })
  })

  it('depósito ligado ao recebimento abate o que falta separar', async () => {
    const { farm, summary, pay } = await setup()
    const p = await pay(50000)
    await recordReserveEntry(db, farm.id, { type: 'deposito', date: todayLocal(), amountCents: 17500, notes: '', paymentId: p.id })
    expect(await summary()).toMatchObject({ balanceCents: 17500, pendingCents: 0 })
    expect(pendingForPayment(p, await db.reserveEntries.toArray())).toBe(0)
  })

  it('retirada exige motivo e não passa do saldo', async () => {
    const { farm, summary } = await setup()
    await recordReserveEntry(db, farm.id, { type: 'deposito', date: todayLocal(), amountCents: 100000, notes: '' })
    await expect(recordReserveEntry(db, farm.id, { type: 'retirada', date: todayLocal(), amountCents: 1000, notes: ' ' })).rejects.toThrow(/motivo/)
    await expect(recordReserveEntry(db, farm.id, { type: 'retirada', date: todayLocal(), amountCents: 100001, notes: 'remédio' })).rejects.toThrow(/Saldo insuficiente/)
    await recordReserveEntry(db, farm.id, { type: 'retirada', date: todayLocal(), amountCents: 40000, notes: 'Compra de sal mineral' })
    expect((await summary()).balanceCents).toBe(60000)
  })

  it('estorno de depósito não deixa o saldo negativo', async () => {
    const { farm } = await setup()
    const d = await recordReserveEntry(db, farm.id, { type: 'deposito', date: todayLocal(), amountCents: 10000, notes: '' })
    await recordReserveEntry(db, farm.id, { type: 'retirada', date: todayLocal(), amountCents: 5000, notes: 'despesa' })
    await expect(reverseReserveEntry(db, d.id, '')).rejects.toThrow(/negativo/)
  })

  it('recebimento estornado depois do depósito aparece como transferido a mais', async () => {
    const { farm, summary, pay } = await setup()
    const p = await pay(50000)
    await recordReserveEntry(db, farm.id, { type: 'deposito', date: todayLocal(), amountCents: 17500, notes: '', paymentId: p.id })
    await reversePayment(db, p.id, 'errado')
    expect(await summary()).toMatchObject({ dueCents: 0, pendingCents: 0, surplusCents: 17500 })
  })

  it('depósito geral (sem ligar a um recebimento) abate os pendentes do mais antigo ao mais novo', async () => {
    const { farm, summary, pay } = await setup()
    const p1 = await pay(50000) // separar 175
    const p2 = await pay(150000) // separar 525
    await recordReserveEntry(db, farm.id, { type: 'deposito', date: todayLocal(), amountCents: 30000, notes: 'Transferência dos 35%' })
    let map = reservePendingByPayment(await db.payments.toArray(), await db.reserveEntries.toArray())
    expect([map.get(p1.id), map.get(p2.id)]).toEqual([0, 40000]) // 175 quitado; 525 − 125 = 400
    await recordReserveEntry(db, farm.id, { type: 'deposito', date: todayLocal(), amountCents: 40000, notes: '' })
    map = reservePendingByPayment(await db.payments.toArray(), await db.reserveEntries.toArray())
    expect([map.get(p1.id), map.get(p2.id)]).toEqual([0, 0])
    expect((await summary()).pendingCents).toBe(0)
    expect(pendingForPayment(p2, await db.reserveEntries.toArray(), await db.payments.toArray())).toBe(0)
  })
})


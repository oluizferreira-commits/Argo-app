import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { entriesIn, recordMovement, todayLocal } from '../rebanho/herd'
import { recordPayment, reversePayment } from '../receber/receivables'
import { addDays, buildInstallments, createClient, createSale, setSalePurpose } from '../vendas/sales'
import { pendingForPayment, recordReserveEntry, reservePayments, reservePendingByPayment, reserveShare, reserveSummary, reverseReserveEntry } from './reserve'

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
    purpose: 'pessoal', // só venda pessoal gera reserva
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

  it('venda para a fazenda não entra na reserva; só a pessoal (e mudar o destino muda a conta)', async () => {
    const { sale, summary, pay } = await setup()
    await setSalePurpose(db, sale.id, 'fazenda')
    await pay(100000)
    expect(await summary()).toMatchObject({ targetCents: 0, dueCents: 0, pendingCents: 0 })
    expect(reservePayments(await db.payments.toArray(), await db.sales.toArray())).toHaveLength(0)
    await setSalePurpose(db, sale.id, 'pessoal')
    expect(await summary()).toMatchObject({ targetCents: 350000, dueCents: 35000, pendingCents: 35000 })
    expect(reservePayments(await db.payments.toArray(), await db.sales.toArray())).toHaveLength(1)
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
    await new Promise((r) => setTimeout(r, 5)) // lançados em momentos diferentes, como no uso real
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


describe('conferência de saldo (Mercado Pago)', () => {
  it('bate, diferença e ajuste com motivo', async () => {
    const { recordReserveCheck, adjustFromCheck, daysSinceCheck } = await import('./reserve')
    db = createDatabase(`test-${newId()}`)
    const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
    await recordReserveEntry(db, farm.id, { type: 'deposito', date: todayLocal(), amountCents: 70000, notes: '' })
    const ok = await recordReserveCheck(db, farm.id, { informedCents: 70000, date: todayLocal() })
    expect(ok).toMatchObject({ account: 'Mercado Pago', systemCents: 70000, differenceCents: 0 })
    const off = await recordReserveCheck(db, farm.id, { informedCents: 69000, date: todayLocal() })
    expect(off.differenceCents).toBe(-1000)
    await expect(adjustFromCheck(db, off, ' ')).rejects.toThrow(/motivo/)
    const adj = await adjustFromCheck(db, off, 'Tarifa do banco')
    expect(adj).toMatchObject({ type: 'retirada', amountCents: 1000 })
    expect(adj.notes).toContain('Tarifa do banco')
    // ajuste repetido (toque duplo) não duplica
    await adjustFromCheck(db, off, 'Tarifa do banco')
    expect((await db.reserveEntries.toArray()).filter((e) => e.type === 'retirada').length).toBe(1)
    const again = await recordReserveCheck(db, farm.id, { informedCents: 69000, date: todayLocal() })
    expect(again.differenceCents).toBe(0)
    expect(daysSinceCheck(await db.reserveChecks.toArray())).toBe(0)
    expect(daysSinceCheck([])).toBeNull()
    await expect(recordReserveCheck(db, farm.id, { informedCents: -1, date: todayLocal() })).rejects.toThrow(/saldo/)
  })
})

describe('percentual da reserva definido pelo responsável', () => {
  it('padrão 35%, mudança vale a partir da data e cada fazenda tem o seu', async () => {
    const { rateOn, setReserveRate, currentRate, formatPercent } = await import('./reserve')
    const { farm, summary, pay } = await setup()
    expect(currentRate(farm)).toBe(35)
    // recebimento de ontem (35%)
    const ontem = addDays(todayLocal(), -1)
    // venda de 5 dias atrás, recebida ontem
    const pasture = (await db.pastures.toArray())[0]
    const client = (await db.clients.toArray())[0]
    const antiga = await createSale(db, farm.id, {
      date: addDays(todayLocal(), -5),
      clientId: client.id,
      mode: 'cabeca',
      items: [{ pastureId: pasture.id, category: 'boi', quantity: 1 }],
      weighing: null,
      animals: [],
      pricePerArrobaCents: null,
      pricePerHeadCents: { boi: 100000 },
      paymentKind: 'prazo',
      installments: buildInstallments('prazo', addDays(todayLocal(), -5), 100000, { days: 30 }),
      notes: '',
      purpose: 'pessoal', // só venda pessoal gera reserva
    })
    await recordPayment(db, farm.id, { saleId: antiga.id, date: ontem, amountCents: 100000, method: 'pix', notes: '' })
    const f30 = await setReserveRate(db, farm, 30, todayLocal())
    expect(rateOn(f30, ontem)).toBe(35)
    expect(currentRate(f30)).toBe(30)
    await pay(100000) // hoje (30%)
    const s = reserveSummary(
      await db.sales.toArray(),
      await db.payments.toArray(),
      await db.reserveEntries.toArray(),
      f30,
    )
    expect(s.dueCents).toBe(35000 + 30000)
    // sem informar a fazenda, continua 35% (compatível)
    expect((await summary()).dueCents).toBe(70000)
    const f325 = await setReserveRate(db, f30, 32.5, todayLocal())
    expect(currentRate(f325)).toBe(32.5)
    expect(formatPercent(32.5)).toBe('32,5%')
    expect(reserveShare(100000, 32.5)).toBe(32500)
    await expect(setReserveRate(db, farm, 0, todayLocal())).rejects.toThrow(/maior que 0/)
    await expect(setReserveRate(db, farm, 150, todayLocal())).rejects.toThrow(/no máximo 100/)
    await expect(setReserveRate(db, farm, 10.555, todayLocal())).rejects.toThrow(/duas casas/)
    await expect(setReserveRate(db, farm, 20, addDays(todayLocal(), 1))).rejects.toThrow(/futuro/)
    const other = await createFarm(db, { name: 'Fazenda do Irmão', responsible: '', city: '' }, '')
    const o20 = await setReserveRate(db, other, 20, todayLocal())
    expect(currentRate(o20)).toBe(20)
    expect(currentRate((await db.farms.get(farm.id))!)).toBe(32.5)
    const hist = await db.auditLog.where('[entity+entityId]').equals(['farms', farm.id]).toArray()
    expect(hist.filter((h) => h.action === 'update').length).toBeGreaterThanOrEqual(2)
  })
})

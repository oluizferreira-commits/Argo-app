import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { balanceOf, computeBalances, entriesIn, recordMovement, todayLocal } from '../rebanho/herd'
import { buildInstallments, createClient, createSale } from '../vendas/sales'
import { addWeighing, cancelLot, createLot, lotSummary, removeWeighing } from './lots'

let db: ArgoDatabase
afterEach(async () => db?.delete())

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
  const p = await createPasture(db, farm.id, { name: 'Pasto', areaHa: null, notes: '' })
  await recordMovement(db, { type: 'compra', date: todayLocal(), notes: '', entries: entriesIn(p.id, { garrote: 50 }) })
  const client = await createClient(db, farm.id, { name: 'Frigorífico', phone: '', city: '', document: '' })
  return { farm, p, client }
}

describe('pesagem de lote (pesar primeiro, vender depois)', () => {
  it('pesa sem tirar do rebanho; a venda usa as pesagens e marca o lote como vendido', async () => {
    const { farm, p, client } = await setup()
    const lot = await createLot(db, farm.id, 'Garrotes')
    await addWeighing(db, lot.id, { pastureId: p.id, category: 'garrote', heads: 3, kgTenths: 10500 })
    await addWeighing(db, lot.id, { pastureId: p.id, category: 'garrote', heads: 2, kgTenths: 7100 })
    const x = await addWeighing(db, lot.id, { pastureId: p.id, category: 'garrote', heads: 1, kgTenths: 3600 })
    await removeWeighing(db, lot.id, x.weighings[2].id)
    let l = (await db.weighingLots.get(lot.id))!
    expect(lotSummary(l)).toMatchObject({ heads: 5, kgTenths: 17600, avgTenths: 3520 })
    // ainda nada saiu do rebanho
    expect(balanceOf(computeBalances(await db.movements.toArray()), p.id, 'garrote')).toBe(50)

    const animals = l.weighings.map((w) => ({ pastureId: w.pastureId, category: w.category, amount: w.kgTenths, heads: w.heads }))
    const total = 1760 * 1250 // 1.760 kg × R$ 12,50
    const sale = await createSale(db, farm.id, {
      date: todayLocal(),
      clientId: client.id,
      mode: 'kg',
      items: lotSummary(l).items,
      weighing: null,
      animals,
      pricePerArrobaCents: null,
      pricePerKgCents: 1250,
      pricePerHeadCents: {},
      paymentKind: 'avista',
      installments: buildInstallments('avista', todayLocal(), total),
      notes: '',
      weighingLotId: lot.id,
    })
    expect(sale.totalCents).toBe(total)
    l = (await db.weighingLots.get(lot.id))!
    expect(l).toMatchObject({ status: 'vendida', saleId: sale.id })
    expect(balanceOf(computeBalances(await db.movements.toArray()), p.id, 'garrote')).toBe(45)
    // lote vendido não aceita mais pesagem nem segunda venda
    await expect(addWeighing(db, lot.id, { pastureId: p.id, category: 'garrote', heads: 1, kgTenths: 3600 })).rejects.toThrow('já foi vendido')
  })

  it('a venda precisa usar exatamente as pesagens do lote', async () => {
    const { farm, p, client } = await setup()
    const lot = await createLot(db, farm.id)
    await addWeighing(db, lot.id, { pastureId: p.id, category: 'garrote', heads: 3, kgTenths: 10500 })
    await expect(
      createSale(db, farm.id, {
        date: todayLocal(),
        clientId: client.id,
        mode: 'kg',
        items: [{ pastureId: p.id, category: 'garrote', quantity: 3 }],
        weighing: null,
        animals: [{ pastureId: p.id, category: 'garrote', amount: 9999, heads: 3 }],
        pricePerArrobaCents: null,
        pricePerKgCents: 1250,
        pricePerHeadCents: {},
        paymentKind: 'avista',
        installments: buildInstallments('avista', todayLocal(), Math.round(999.9 * 1250)),
        notes: '',
        weighingLotId: lot.id,
      }),
    ).rejects.toThrow('diferentes das do lote')
    expect((await db.weighingLots.get(lot.id))!.status).toBe('aberta')
    expect(await db.sales.count()).toBe(0)
  })

  it('valida as pesagens e permite cancelar o lote', async () => {
    const { farm, p } = await setup()
    const lot = await createLot(db, farm.id)
    await expect(addWeighing(db, lot.id, { pastureId: p.id, category: 'garrote', heads: 4, kgTenths: 14000 })).rejects.toThrow('de 1 a 3')
    await expect(addWeighing(db, lot.id, { pastureId: p.id, category: 'garrote', heads: 3, kgTenths: 100 })).rejects.toThrow('fora do normal')
    await cancelLot(db, lot.id)
    await expect(addWeighing(db, lot.id, { pastureId: p.id, category: 'garrote', heads: 1, kgTenths: 3600 })).rejects.toThrow('cancelada')
  })
})

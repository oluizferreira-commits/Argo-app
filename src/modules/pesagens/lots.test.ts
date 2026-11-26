import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { balanceOf, computeBalances, entriesIn, recordMovement, todayLocal } from '../rebanho/herd'
import { buildInstallments, createClient, createSale, type SaleInput } from '../vendas/sales'
import { addWeighing, cancelLot, compositionOf, createLot, lotSummary, removeWeighing, setComposition } from './lots'

let db: ArgoDatabase
afterEach(async () => db?.delete())

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
  const p = await createPasture(db, farm.id, { name: 'Pasto', areaHa: null, notes: '' })
  await recordMovement(db, { type: 'compra', date: todayLocal(), notes: '', entries: entriesIn(p.id, { garrote: 50, novilha: 30 }) })
  const client = await createClient(db, farm.id, { name: 'Frigorífico', phone: '', city: '', document: '' })
  return { farm, p, client }
}

const saleInput = (clientId: string, items: SaleInput['items'], weighings: { heads: number; kgTenths: number }[], total: number, lotId?: string): SaleInput => ({
  date: todayLocal(),
  clientId,
  mode: 'kg',
  items,
  weighing: null,
  animals: [],
  weighings,
  pricePerArrobaCents: null,
  pricePerKgCents: 1250,
  pricePerHeadCents: {},
  paymentKind: 'avista',
  installments: buildInstallments('avista', todayLocal(), total),
  notes: '',
  weighingLotId: lotId,
})

describe('pesagem de lote com animais misturados na balança', () => {
  it('pesa só cabeças e peso; a composição (categorias) é dita uma vez; a venda tira do rebanho', async () => {
    const { farm, p, client } = await setup()
    const lot = await createLot(db, farm.id, 'Lote misto')
    await addWeighing(db, lot.id, { heads: 3, kgTenths: 10500 }) // 2 garrotes + 1 novilha, misturados
    await addWeighing(db, lot.id, { heads: 2, kgTenths: 6900 })
    const x = await addWeighing(db, lot.id, { heads: 1, kgTenths: 3600 })
    await removeWeighing(db, lot.id, x.weighings[2].id)
    await setComposition(db, lot.id, [
      { pastureId: p.id, category: 'garrote', quantity: 3 },
      { pastureId: p.id, category: 'novilha', quantity: 2 },
    ])
    let l = (await db.weighingLots.get(lot.id))!
    expect(lotSummary(l)).toMatchObject({ heads: 5, kgTenths: 17400, avgTenths: 3480 })
    expect(compositionOf(l)).toHaveLength(2)
    expect(balanceOf(computeBalances(await db.movements.toArray()), p.id, 'garrote')).toBe(50) // nada saiu ainda

    const total = 1740 * 1250
    const sale = await createSale(db, farm.id, saleInput(client.id, compositionOf(l), l.weighings.map((w) => ({ heads: w.heads, kgTenths: w.kgTenths })), total, lot.id))
    expect(sale.totalCents).toBe(total)
    expect(sale.weighings).toEqual([
      { heads: 3, kgTenths: 10500 },
      { heads: 2, kgTenths: 6900 },
    ])
    l = (await db.weighingLots.get(lot.id))!
    expect(l).toMatchObject({ status: 'vendida', saleId: sale.id })
    const b = computeBalances(await db.movements.toArray())
    expect(balanceOf(b, p.id, 'garrote')).toBe(47)
    expect(balanceOf(b, p.id, 'novilha')).toBe(28)
    await expect(addWeighing(db, lot.id, { heads: 1, kgTenths: 3600 })).rejects.toThrow('já foi vendido')
  })

  it('cabeças pesadas têm de bater com a quantidade vendida; pesagens têm de ser as do lote', async () => {
    const { farm, p, client } = await setup()
    const lot = await createLot(db, farm.id)
    await addWeighing(db, lot.id, { heads: 3, kgTenths: 10500 })
    await expect(createSale(db, farm.id, saleInput(client.id, [{ pastureId: p.id, category: 'garrote', quantity: 4 }], [{ heads: 3, kgTenths: 10500 }], 1050 * 1250))).rejects.toThrow('Pesadas 3 cabeças, mas a venda tem 4')
    await expect(createSale(db, farm.id, saleInput(client.id, [{ pastureId: p.id, category: 'garrote', quantity: 3 }], [{ heads: 3, kgTenths: 9999 }], Math.round(999.9 * 1250), lot.id))).rejects.toThrow('diferentes das do lote')
    expect((await db.weighingLots.get(lot.id))!.status).toBe('aberta')
    expect(await db.sales.count()).toBe(0)
  })

  it('valida as pesagens e permite cancelar o lote', async () => {
    const { farm } = await setup()
    const lot = await createLot(db, farm.id)
    await addWeighing(db, lot.id, { heads: 4, kgTenths: 14000 }) // 4 cabeças: aceito
    await expect(addWeighing(db, lot.id, { heads: 5, kgTenths: 17500 })).rejects.toThrow('de 1 a 4')
    await expect(addWeighing(db, lot.id, { heads: 3, kgTenths: 100 })).rejects.toThrow('fora do normal')
    await cancelLot(db, lot.id)
    await expect(addWeighing(db, lot.id, { heads: 1, kgTenths: 3600 })).rejects.toThrow('cancelada')
  })

  it('lote da versão anterior (pesagem com pasto/categoria) vira composição automaticamente', () => {
    const items = compositionOf({
      weighings: [
        { id: 'a', pastureId: 'p1', category: 'garrote', heads: 3, kgTenths: 10000, at: '' },
        { id: 'b', pastureId: 'p1', category: 'garrote', heads: 2, kgTenths: 7000, at: '' },
      ],
    })
    expect(items).toEqual([{ pastureId: 'p1', category: 'garrote', quantity: 5 }])
  })
})

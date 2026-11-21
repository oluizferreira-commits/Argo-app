import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { computeIndicators, type DashboardData } from '../dashboard/dashboard'
import { createEquipment, fuelStock, recordFuelMovement, reverseFuelMovement } from '../diesel/fuel'
import { createFarm } from '../fazendas/farms'
import { createSupply, isLowStock, NegativeStockError, recordSupplyMovement, reverseSupplyMovement, supplyLedger, supplyStock } from '../insumos/supplies'
import { createPasture } from '../pastos/pastures'
import { todayLocal } from '../rebanho/herd'
import { createResponsible } from '../responsaveis/responsibles'
import { addDays } from '../vendas/sales'
import { buildReports } from '../relatorios/reports'
import { EMPTY_FILTER, manejoStats } from './manejoStats'
import { cancelOperation, costPerHa, createOperation, currentGrass, OperationError, type OperationInput } from './operations'

let db: ArgoDatabase
afterEach(async () => db?.delete())
const today = todayLocal()
const L = (n: number) => n * 1000 // litros/kg → mL/g

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
  const pasto = await createPasture(db, farm.id, { name: 'Pasto da Grota', areaHa: 40, notes: '' })
  const ze = await createResponsible(db, farm.id, 'Zé', 'tratorista')
  const trator = await createEquipment(db, farm.id, { name: 'John Deere 7230J', type: 'Trator', identification: '', responsibleId: ze.id, meter: 'horimetro' })
  const pulv = await createEquipment(db, farm.id, { name: 'Pulverizador', type: 'Implemento', identification: '', responsibleId: null, meter: 'nenhum' })
  const tordon = await createSupply(db, farm.id, 'Tordon', null, undefined, undefined, { category: 'herbicida', unit: 'L', manufacturer: 'Corteva', activeIngredient: 'Picloram + 2,4-D', minQty: L(10) })
  const garlon = await createSupply(db, farm.id, 'Garlon', null, undefined, undefined, { category: 'herbicida', unit: 'L' })
  const marandu = await createSupply(db, farm.id, 'Marandu', null, undefined, undefined, { category: 'semente', unit: 'kg', species: 'Brachiaria brizantha', cultivar: 'Marandu', culturalValue: 800 })
  const buy = (supplyId: string, qty: number, reais: number, extra: object = {}) =>
    recordSupplyMovement(db, farm.id, { supplyId, type: 'compra', date: addDays(today, -10), qty, costCents: reais * 100, supplier: 'Agro', invoice: 'NF 123', ...extra })
  await recordFuelMovement(db, farm.id, { type: 'compra', date: addDays(today, -10), centiliters: 100000, totalCents: 600000, station: 'Posto' }) // 1.000 L a R$ 6,00
  const base: OperationInput = { type: 'herbicida', date: today, pastureId: pasto.id, workedAreaCentiHa: 1500, responsibleId: ze.id, products: [], equipments: [], otherCosts: [], notes: '' }
  const movs = () => db.supplyMovements.toArray()
  const fuel = async () => fuelStock(await db.fuelMovements.toArray())
  return { farm, pasto, ze, trator, pulv, tordon, garlon, marandu, buy, base, movs, fuel }
}

describe('estoque de herbicidas e sementes', () => {
  it('compra em litros com NF, custo médio ponderado e estoque baixo', async () => {
    const { tordon, buy, movs } = await setup()
    await buy(tordon.id, L(20), 1000) // R$ 50/L
    await buy(tordon.id, L(10), 800) // R$ 80/L → média (1000+800)/30 = R$ 60/L
    const l = supplyLedger(await movs(), tordon.id)
    expect(l.balance).toBe(L(30))
    expect(l.valueCents).toBe(180000)
    const m = (await movs()).find((x) => x.supplyId === tordon.id)!
    expect(m.invoice).toBe('NF 123')
    expect(isLowStock(tordon, L(9))).toBe(true)
    expect(isLowStock(tordon, L(30))).toBe(false)
  })
})

describe('Fluxo A — aplicação de herbicida', () => {
  it('mistura de produtos, aplicação parcial, trator + pulverizador, diesel único e custos', async () => {
    const { farm, pasto, ze, trator, pulv, tordon, garlon, buy, base, movs, fuel } = await setup()
    await buy(tordon.id, L(20), 1000) // R$ 50/L
    await buy(garlon.id, L(10), 900) // R$ 90/L
    const op = await createOperation(db, farm.id, {
      ...base,
      products: [
        { supplyId: tordon.id, qty: L(6) },
        { supplyId: garlon.id, qty: 1500 },
      ],
      equipments: [
        { equipmentId: trator.id, responsibleId: null, meterStart: 12000, meterEnd: 12055, hoursTenths: null, dieselCl: 7500 },
        { equipmentId: pulv.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: null, dieselCl: 0 },
      ],
      otherCosts: [{ description: 'Diária do aplicador', costCents: 20000 }],
    })
    // custos: Tordon 6 L × 50 = 300; Garlon 1,5 L × 90 = 135; diesel 75 L × 6 = 450; outros 200
    expect(op.productsCents).toBe(43500)
    expect(op.dieselCents).toBe(45000)
    expect(op.otherCents).toBe(20000)
    expect(op.totalCents).toBe(108500)
    expect(costPerHa(op)).toBe(Math.round(108500 / 15)) // 15 ha de 40 (parcial)
    expect(op.equipments[0]).toMatchObject({ hoursTenths: 55, responsibleId: ze.id })
    // estoque: baixa feita uma vez
    expect(supplyStock(await movs(), tordon.id)).toBe(L(14))
    expect(supplyStock(await movs(), garlon.id)).toBe(8500)
    // diesel: um único consumo, ligado ao equipamento, responsável, operação e pasto
    expect(await fuel()).toBe(100000 - 7500)
    const fm = (await db.fuelMovements.toArray()).filter((f) => f.operationId === op.id)
    expect(fm).toHaveLength(1)
    expect(fm[0]).toMatchObject({ equipmentId: trator.id, responsibleId: ze.id, pastureId: pasto.id, meterReading: 12055 })
    // financeiro: consumo não vira despesa (só as compras contam)
    const d = { farm: (await db.farms.get(farm.id))!, pastures: [], movements: [], sales: [], payments: [], clients: [], reserveEntries: [], supplies: [], supplyMovements: await movs(), fuelMovements: await db.fuelMovements.toArray(), equipments: [], tasks: [], audit: [] } as DashboardData
    const ind = computeIndicators(d, today)
    if (addDays(today, -10).slice(0, 7) === today.slice(0, 7)) expect(ind.expensesMonthCents).toBe(100000 + 90000 + 600000)
    // idempotência: mesmo envio não baixa duas vezes
    const key = newId()
    await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(1) }] }, key)
    await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(1) }] }, key)
    expect(supplyStock(await movs(), tordon.id)).toBe(L(13))
  })

  it('consumo da operação não pode ser estornado solto no Diesel/Insumos', async () => {
    const { farm, trator, tordon, buy, base } = await setup()
    await buy(tordon.id, L(5), 250)
    const op = await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(1) }], equipments: [{ equipmentId: trator.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: 20, dieselCl: 1000 }] })
    await expect(reverseFuelMovement(db, op.equipments[0].fuelMovementId!, 'x')).rejects.toThrow('operação de campo')
    await expect(reverseSupplyMovement(db, op.products[0].movementId, 'x')).rejects.toThrow('operação de campo')
  })

  it('estoque insuficiente pede autorização; área não passa da área do pasto', async () => {
    const { farm, tordon, buy, base } = await setup()
    await buy(tordon.id, L(2), 100)
    await expect(createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(3) }] })).rejects.toBeInstanceOf(NegativeStockError)
    expect(await db.fieldOperations.count()).toBe(0) // nada gravado pela metade
    await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(3) }] }, undefined, { authorize: { reason: 'compra a lançar' } })
    await expect(createOperation(db, farm.id, { ...base, workedAreaCentiHa: 4100, products: [{ supplyId: tordon.id, qty: 1 }] })).rejects.toThrow('área do pasto')
  })
})

describe('Fluxo B — plantio de capim', () => {
  it('sementes de duas variedades, trator e implemento, horas, diesel, custos por ha e espécie do pasto', async () => {
    const { farm, pasto, trator, pulv, marandu, buy, base, movs } = await setup()
    const piata = await createSupply(db, farm.id, 'Piatã', null, undefined, undefined, { category: 'semente', unit: 'kg', species: 'Brachiaria brizantha', cultivar: 'Piatã' })
    await buy(marandu.id, L(200), 3000, { lot: 'L-01' }) // 200 kg = R$ 15/kg
    await buy(piata.id, L(100), 1800, { lot: 'P-07' }) // 100 kg = R$ 18/kg
    const op = await createOperation(db, farm.id, {
      ...base,
      type: 'plantio',
      workedAreaCentiHa: 2000, // 20 de 40 ha (parcial)
      products: [
        { supplyId: marandu.id, qty: L(100), lot: 'L-01' },
        { supplyId: piata.id, qty: L(20), lot: 'P-07' },
      ],
      equipments: [
        { equipmentId: trator.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: 120, dieselCl: 10500 },
        { equipmentId: pulv.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: 120, dieselCl: 0 },
      ],
      otherCosts: [{ description: 'Mão de obra', costCents: 40000 }],
    })
    expect(op.seedsCents).toBe(150000 + 36000) // 100 kg × 15 + 20 kg × 18
    expect(op.dieselCents).toBe(63000) // 105 L × 6
    expect(op.totalCents).toBe(186000 + 63000 + 40000)
    expect(op.products.map((p) => p.lot)).toEqual(['L-01', 'P-07'])
    expect(supplyStock(await movs(), marandu.id)).toBe(L(100))
    expect(currentGrass(await db.fieldOperations.toArray(), pasto.id)?.text).toBe('Brachiaria brizantha Marandu + Brachiaria brizantha Piatã')
    // plantio só aceita sementes
    const herb = await createSupply(db, farm.id, 'Roundup', null, undefined, undefined, { category: 'herbicida', unit: 'L' })
    await expect(createOperation(db, farm.id, { ...base, type: 'plantio', products: [{ supplyId: herb.id, qty: 1 }] })).rejects.toThrow('não é semente')
  })
})

describe('correção e cancelamento', () => {
  it('corrigir cancela a anterior (devolve estoque e diesel) e grava a nova, com rastreio', async () => {
    const { farm, trator, tordon, buy, base, movs, fuel } = await setup()
    await buy(tordon.id, L(20), 1000)
    const a = await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(8) }], equipments: [{ equipmentId: trator.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: 30, dieselCl: 6000 }] })
    await expect(createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(6) }] }, undefined, { replacesId: a.id })).rejects.toThrow('motivo')
    const b = await createOperation(
      db,
      farm.id,
      { ...base, products: [{ supplyId: tordon.id, qty: L(6) }], equipments: [{ equipmentId: trator.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: 30, dieselCl: 5000 }] },
      undefined,
      { replacesId: a.id, correctionReason: 'quantidade errada' },
    )
    const old = (await db.fieldOperations.get(a.id))!
    expect(old).toMatchObject({ status: 'cancelada', replacedById: b.id })
    expect(old.cancelReason).toContain('quantidade errada')
    expect(b.replacesId).toBe(a.id)
    expect(supplyStock(await movs(), tordon.id)).toBe(L(14))
    expect(await fuel()).toBe(100000 - 5000)
    await expect(createOperation(db, farm.id, base, undefined, { replacesId: a.id, correctionReason: 'x' })).rejects.toThrow(OperationError)
  })

  it('cancelar devolve tudo e mantém o histórico', async () => {
    const { farm, trator, tordon, buy, base, movs, fuel } = await setup()
    await buy(tordon.id, L(20), 1000)
    const a = await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(8) }], equipments: [{ equipmentId: trator.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: 30, dieselCl: 6000 }] })
    await cancelOperation(db, a.id, 'lançada no pasto errado')
    expect(supplyStock(await movs(), tordon.id)).toBe(L(20))
    expect(await fuel()).toBe(100000)
    expect((await db.supplyMovements.toArray()).filter((m) => m.operationId === a.id).every((m) => m.status === 'estornado')).toBe(true)
    await expect(cancelOperation(db, a.id, 'de novo')).rejects.toThrow('já foi cancelada')
  })

  it('custo guardado na operação não muda com compras lançadas depois', async () => {
    const { farm, tordon, buy, base } = await setup()
    await buy(tordon.id, L(10), 500) // R$ 50/L
    const a = await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(2) }] })
    await recordSupplyMovement(db, farm.id, { supplyId: tordon.id, type: 'compra', date: today, qty: L(10), costCents: 200000, supplier: 'X' })
    expect((await db.fieldOperations.get(a.id))!.productsCents).toBe(10000)
  })
})

describe('indicadores, custo por pasto e relatório', () => {
  it('soma por pasto, formação x manutenção, filtros e canceladas fora', async () => {
    const { farm, pasto, trator, tordon, marandu, buy, base } = await setup()
    await buy(tordon.id, L(20), 1000) // R$ 50/L
    await buy(marandu.id, L(100), 1500) // R$ 15/kg
    const outro = await createPasture(db, farm.id, { name: 'Outro', areaHa: null, notes: '' })
    await createOperation(db, farm.id, { ...base, type: 'plantio', products: [{ supplyId: marandu.id, qty: L(40) }], equipments: [{ equipmentId: trator.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: 50, dieselCl: 5000 }] })
    await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(4) }] })
    const x = await createOperation(db, farm.id, { ...base, pastureId: outro.id, products: [{ supplyId: tordon.id, qty: L(2) }] })
    await cancelOperation(db, x.id, 'errada')
    const ops = await db.fieldOperations.toArray()
    const st = manejoStats(ops, await db.supplies.toArray(), await db.supplyMovements.toArray(), await db.pastures.toArray(), today)
    expect(st.operations).toHaveLength(2)
    const c = st.pastures.find((p) => p.pastureId === pasto.id)!
    expect(c).toMatchObject({ seedsCents: 60000, herbicideCents: 20000, dieselCents: 30000, totalCents: 110000, formationCents: 90000 })
    expect(c.perHaCents).toBe(Math.round(110000 / 40)) // pasto de 40 ha
    expect(st.seeds.kgUsed).toBe(L(40))
    expect(st.seeds.plantedCentiHa).toBe(1500)
    expect(st.machines).toMatchObject({ dieselCl: 5000, hoursTenths: 50, operations: 2 })
    expect(st.herbicides.stock.find((h) => h.supply.id === tordon.id)?.qty).toBe(L(16)) // cancelada devolveu os 2 L
    expect(manejoStats(ops, [], [], [], today, { ...EMPTY_FILTER, type: 'plantio' }).operations).toHaveLength(1)
    expect(manejoStats(ops, [], [], [], today, { ...EMPTY_FILTER, equipmentId: trator.id }).operations).toHaveLength(1)
    expect(manejoStats(ops, [], [], [], today, { ...EMPTY_FILTER, grass: 'Brachiaria brizantha|Marandu' }).operations).toHaveLength(1)
    const [r] = buildReports(['manejo'], { farm: (await db.farms.get(farm.id))!, pastures: await db.pastures.toArray(), movements: [], sales: [], payments: [], clients: [], reserveEntries: [], fieldOperations: ops, supplies: await db.supplies.toArray(), supplyMovements: await db.supplyMovements.toArray(), today }, { kind: 'ano', year: Number(today.slice(0, 4)) })
    expect(r.tables[0].rows[0][0]).toBe('Pasto da Grota')
    expect(r.tables[1].rows).toHaveLength(2)
  })
})

describe('correção com horímetro', () => {
  it('corrige operação antiga mesmo com leitura maior lançada depois no mesmo trator', async () => {
    const { farm, trator, tordon, buy, base } = await setup()
    await buy(tordon.id, L(20), 1000)
    const eq = (start: number, end: number) => [{ equipmentId: trator.id, responsibleId: null, meterStart: start, meterEnd: end, hoursTenths: null, dieselCl: 1000 }]
    const a = await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(2) }], equipments: eq(12000, 12050) })
    await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(1) }], equipments: eq(12050, 12170) })
    const b = await createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: L(3) }], equipments: eq(12000, 12050) }, undefined, { replacesId: a.id, correctionReason: 'quantidade' })
    expect(b.replacesId).toBe(a.id)
    // lançamento novo (não correção) continua conferindo o horímetro
    await expect(createOperation(db, farm.id, { ...base, products: [{ supplyId: tordon.id, qty: 1 }], equipments: eq(11000, 11010) })).rejects.toThrow('menor que a anterior')
  })
})

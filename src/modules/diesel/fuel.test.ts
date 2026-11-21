import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { todayLocal } from '../rebanho/herd'
import { createResponsible } from '../responsaveis/responsibles'
import { addDays } from '../vendas/sales'
import {
  createEquipment,
  FuelError,
  fuelLedger,
  FuelNegativeError,
  fuelStock,
  parseLiters,
  parseMeter,
  pricePerLiter,
  recordFuelMovement,
  reverseFuelMovement,
  setEquipmentActive,
} from './fuel'

let db: ArgoDatabase
afterEach(async () => db?.delete())

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'Fazenda Teste', responsible: '', city: '' }, '')
  const ze = await createResponsible(db, farm.id, 'Zé', 'tratorista')
  const trator = await createEquipment(db, farm.id, { name: 'Trator MF 275', type: 'Trator', identification: 'MF-01', responsibleId: ze.id, meter: 'horimetro' })
  const all = () => db.fuelMovements.toArray()
  const buy = (liters: number, totalReais: number, daysAgo = 5, key?: string) =>
    recordFuelMovement(db, farm.id, { type: 'compra', date: addDays(todayLocal(), -daysAgo), centiliters: liters * 100, totalCents: totalReais * 100, station: 'Posto Redenção' }, key)
  const use = (liters: number, meter: number | null = null, daysAgo = 0, authorize?: { reason: string }) =>
    recordFuelMovement(
      db,
      farm.id,
      { type: 'consumo', date: addDays(todayLocal(), -daysAgo), centiliters: liters * 100, equipmentId: trator.id, responsibleId: ze.id, meterReading: meter },
      undefined,
      authorize,
    )
  return { farm, ze, trator, all, buy, use }
}

describe('unidades', () => {
  it('litros e leituras', () => {
    expect(parseLiters('150')).toBe(15000)
    expect(parseLiters('150,5')).toBe(15050)
    expect(parseLiters('1.000')).toBe(100000)
    expect(() => parseLiters('0')).toThrow(FuelError)
    expect(() => parseLiters('abc')).toThrow(FuelError)
    expect(parseMeter('1250,5')).toBe(12505)
    expect(parseMeter('')).toBeNull()
    expect(pricePerLiter(60000, 10000)).toBe(600) // R$ 600 / 100 L = R$ 6,00
  })
})

describe('diesel', () => {
  it('compra soma, abastecimento desconta', async () => {
    const { buy, use, all } = await setup()
    await buy(1000, 6000)
    await use(80, 1000)
    expect(fuelStock(await all())).toBe(92000)
  })

  it('custo médio ponderado', async () => {
    const { buy, use, all } = await setup()
    await buy(1000, 6000, 10) // R$ 6,00/L
    await use(500, null, 9) // sai a R$ 6,00 → R$ 3.000
    await buy(500, 3500, 8) // estoque 500 L a R$ 3.000 + 500 L a R$ 3.500 → R$ 6,50/L
    await use(100, null, 7)
    const l = fuelLedger(await all())
    expect(l.lines.map((x) => x.avgCents)).toEqual([600, 600, 650, 650])
    expect(l.lines[1].costCents).toBe(300000)
    expect(l.lines[3].costCents).toBe(65000)
    expect(l.balanceCl).toBe(90000)
    expect(l.valueCents).toBe(585000)
  })

  it('custo médio segue a data, não a ordem de digitação', async () => {
    const { buy, use, all } = await setup()
    await buy(100, 700, 1) // compra de ontem: R$ 7,00
    await buy(100, 500, 10) // compra antiga lançada depois: R$ 5,00
    await use(50, null, 5) // entre as duas: sai a R$ 5,00
    const l = fuelLedger(await all())
    expect(l.lines.map((x) => x.movement.date)).toEqual([addDays(todayLocal(), -10), addDays(todayLocal(), -5), addDays(todayLocal(), -1)])
    expect(l.lines[1].costCents).toBe(25000)
    expect(l.avgCents).toBe(Math.round(((50 * 500 + 700 * 100) * 100) / 15000))
  })

  it('compra exige posto e valor; abastecimento exige equipamento', async () => {
    const { farm } = await setup()
    await expect(recordFuelMovement(db, farm.id, { type: 'compra', date: todayLocal(), centiliters: 100, totalCents: 1000, station: '' })).rejects.toThrow('posto')
    await expect(recordFuelMovement(db, farm.id, { type: 'compra', date: todayLocal(), centiliters: 100, station: 'X' })).rejects.toThrow('valor')
    await expect(recordFuelMovement(db, farm.id, { type: 'consumo', date: todayLocal(), centiliters: 100 })).rejects.toThrow('equipamento')
  })

  it('bloqueia estoque negativo sem autorização', async () => {
    const { buy, use, all } = await setup()
    await buy(50, 300)
    await expect(use(80)).rejects.toBeInstanceOf(FuelNegativeError)
    expect(fuelStock(await all())).toBe(5000)
    const m = await use(80, null, 0, { reason: 'nota do posto ainda não chegou' })
    expect(m.authorizedNegative).toBe(true)
    expect(fuelStock(await all())).toBe(-3000)
  })

  it('horímetro não pode voltar', async () => {
    const { buy, use } = await setup()
    await buy(1000, 6000)
    await use(50, 12000, 2)
    await expect(use(50, 11990, 1)).rejects.toThrow('menor que a anterior')
    await use(50, 12080, 1)
  })

  it('estorno mantém histórico e não deixa o estoque negativo', async () => {
    const { buy, use, all } = await setup()
    const c = await buy(100, 600)
    const u = await use(30)
    await reverseFuelMovement(db, u.id, 'lançado duas vezes')
    expect(fuelStock(await all())).toBe(10000)
    await use(60)
    await expect(reverseFuelMovement(db, c.id, 'x')).rejects.toThrow('negativo')
    expect((await db.fuelMovements.get(u.id))?.status).toBe('estornado')
  })

  it('não duplica a mesma compra (idempotência)', async () => {
    const { buy, all } = await setup()
    const key = newId()
    await buy(100, 600, 1, key)
    await buy(100, 600, 1, key)
    expect(fuelStock(await all())).toBe(10000)
  })

  it('equipamentos: nome único e desativação', async () => {
    const { farm, trator } = await setup()
    await expect(createEquipment(db, farm.id, { name: 'trator mf 275', type: '', identification: '', responsibleId: null, meter: 'nenhum' })).rejects.toThrow('Já existe')
    const off = await setEquipmentActive(db, trator.id, false)
    expect(off.active).toBe(false)
    expect(await db.equipments.count()).toBe(1)
  })
})

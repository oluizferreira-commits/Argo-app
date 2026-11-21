import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import { createFarm } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { todayLocal } from '../rebanho/herd'
import { addDays } from '../vendas/sales'
import { createResponsible, ResponsibleError, setResponsibleActive, updateResponsible } from '../responsaveis/responsibles'
import {
  createSupply,
  ensureDefaultSupplies,
  formatSacks,
  NegativeStockError,
  parseKgPerSack,
  parseSacks,
  recordSupplyMovement,
  reverseSupplyMovement,
  sacksToKg,
  supplyStock,
  SupplyError,
} from './supplies'

let db: ArgoDatabase
afterEach(async () => db?.delete())

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'Fazenda Teste', responsible: '', city: '' }, '')
  const pasture = await createPasture(db, farm.id, { name: 'Pasto 1', areaHa: null, notes: '' })
  await ensureDefaultSupplies(db, farm.id)
  const supplies = await db.supplies.where('farmId').equals(farm.id).toArray()
  const sal = supplies.find((s) => s.name === 'Sal mineral')!
  const stock = async () => supplyStock(await db.supplyMovements.toArray(), sal.id)
  const buy = (halves: number, key?: string) =>
    recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'compra', date: addDays(todayLocal(), -2), halves, costCents: 15000 * halves, supplier: 'Agropecuária' }, key)
  const use = (halves: number, authorize?: { reason: string }) =>
    recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'consumo', date: todayLocal(), halves, pastureId: pasture.id }, undefined, authorize)
  return { farm, pasture, sal, supplies, stock, buy, use }
}

describe('unidades', () => {
  it('aceita só sacos inteiros ou meio saco', () => {
    expect(parseSacks('1')).toBe(2)
    expect(parseSacks('0,5')).toBe(1)
    expect(parseSacks('2.5')).toBe(5)
    expect(() => parseSacks('0,3')).toThrow(SupplyError)
    expect(() => parseSacks('1,25')).toThrow(SupplyError)
    expect(() => parseSacks('0')).toThrow(SupplyError)
    expect(() => parseSacks('-1')).toThrow(SupplyError)
  })
  it('converte para kg conforme o peso do saco', () => {
    expect(sacksToKg(3, 25000)).toBe(37.5)
    expect(sacksToKg(3, null)).toBeNull()
    expect(parseKgPerSack('30')).toBe(30000)
    expect(parseKgPerSack('25,5')).toBe(25500)
    expect(formatSacks(1)).toBe('0,5 saco')
    expect(formatSacks(3)).toBe('1,5 sacos')
  })
})

describe('insumos', () => {
  it('cria Sal branco e Sal mineral uma única vez', async () => {
    const { farm, supplies } = await setup()
    expect(supplies.map((s) => s.name).sort()).toEqual(['Sal branco', 'Sal mineral'])
    await ensureDefaultSupplies(db, farm.id)
    expect(await db.supplies.count()).toBe(2)
  })

  it('cadastra outros produtos sem duplicar nomes', async () => {
    const { farm } = await setup()
    await createSupply(db, farm.id, 'Ração proteinada', 30000)
    await expect(createSupply(db, farm.id, 'sal MINERAL', null)).rejects.toThrow(SupplyError)
    expect(await db.supplies.count()).toBe(3)
  })

  it('compra soma e consumo no cocho desconta do estoque', async () => {
    const { buy, use, stock } = await setup()
    await buy(10)
    await use(3)
    expect(await stock()).toBe(7)
  })

  it('compra exige valor e fornecedor; consumo exige pasto', async () => {
    const { farm, sal } = await setup()
    await expect(recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'compra', date: todayLocal(), halves: 2, costCents: null, supplier: 'X' })).rejects.toThrow('valor')
    await expect(recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'compra', date: todayLocal(), halves: 2, costCents: 100, supplier: ' ' })).rejects.toThrow('fornecedor')
    await expect(recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'consumo', date: todayLocal(), halves: 2 })).rejects.toThrow('pasto')
    await expect(recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'consumo', date: todayLocal(), halves: 2, pastureId: 'outro' })).rejects.toThrow('Pasto')
  })

  it('bloqueia estoque negativo sem autorização e permite com autorização', async () => {
    const { buy, use, stock } = await setup()
    await buy(2)
    const err = await use(3).catch((e) => e)
    expect(err).toBeInstanceOf(NegativeStockError)
    expect(await stock()).toBe(2)
    await expect(use(3, { reason: '  ' })).rejects.toBeInstanceOf(NegativeStockError)
    const m = await use(3, { reason: 'compra ainda não lançada' })
    expect(m.authorizedNegative).toBe(true)
    expect(m.notes).toContain('compra ainda não lançada')
    expect(await stock()).toBe(-1)
  })

  it('ajuste exige direção e motivo, em meio saco', async () => {
    const { farm, sal, buy, stock } = await setup()
    await buy(4)
    await expect(recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'ajuste', date: todayLocal(), halves: 1, direction: 'saida' })).rejects.toThrow('motivo')
    await expect(recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'ajuste', date: todayLocal(), halves: 1, notes: 'x' })).rejects.toThrow('entrada ou saída')
    await recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'ajuste', date: todayLocal(), halves: 1, direction: 'saida', notes: 'saco rasgado' })
    expect(await stock()).toBe(3)
    await expect(recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'ajuste', date: todayLocal(), halves: 1.5, direction: 'entrada', notes: 'x' })).rejects.toThrow(SupplyError)
  })

  it('estorno mantém o histórico e devolve o estoque', async () => {
    const { buy, use, stock } = await setup()
    const c = await buy(6)
    const u = await use(2)
    await reverseSupplyMovement(db, u.id, 'lançado no pasto errado')
    expect(await stock()).toBe(6)
    const after = await db.supplyMovements.get(u.id)
    expect(after?.status).toBe('estornado')
    expect(after?.reverseReason).toBe('lançado no pasto errado')
    await expect(reverseSupplyMovement(db, u.id, 'de novo')).rejects.toThrow('já foi estornado')
    await use(5)
    await expect(reverseSupplyMovement(db, c.id, 'compra errada')).rejects.toThrow('negativo')
    expect(await db.supplyMovements.count()).toBe(3)
  })

  it('não duplica o mesmo lançamento (idempotência)', async () => {
    const { buy, stock } = await setup()
    const key = newId()
    await buy(4, key)
    await buy(4, key)
    expect(await stock()).toBe(4)
  })

  it('rejeita data futura', async () => {
    const { farm, sal } = await setup()
    await expect(
      recordSupplyMovement(db, farm.id, { supplyId: sal.id, type: 'compra', date: addDays(todayLocal(), 1), halves: 2, costCents: 100, supplier: 'X' }),
    ).rejects.toThrow('futuro')
  })
})

describe('responsáveis', () => {
  it('cadastra, edita, desativa e não duplica nome', async () => {
    db = createDatabase(`test-${newId()}`)
    const farm = await createFarm(db, { name: 'Fazenda Teste', responsible: '', city: '' }, '')
    const r = await createResponsible(db, farm.id, ' João  Silva ', 'tratorista')
    expect(r.name).toBe('João Silva')
    await expect(createResponsible(db, farm.id, 'joão silva', '')).rejects.toBeInstanceOf(ResponsibleError)
    await updateResponsible(db, r, 'João da Silva', 'tratorista')
    const off = await setResponsibleActive(db, r.id, false)
    expect(off.active).toBe(false)
    expect(await db.responsibles.count()).toBe(1)
    expect((await new Repository(db, 'responsibles').history(r.id)).length).toBeGreaterThanOrEqual(3)
  })
})

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
  recipeText,
  recordMixture,
  setRecipe,
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
  // produto comum (não entra na mistura) para os testes gerais de estoque
  const sal = await createSupply(db, farm.id, 'Ração proteinada', 30000)
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
  it('cria Sal branco, Sal mineral e a Mistura de sal uma única vez', async () => {
    const { farm, supplies } = await setup()
    expect(supplies.map((s) => s.name).sort()).toEqual(['Mistura de sal', 'Sal branco', 'Sal mineral'])
    await ensureDefaultSupplies(db, farm.id)
    expect(await db.supplies.count()).toBe(4)
  })

  it('cadastra outros produtos sem duplicar nomes', async () => {
    const { farm } = await setup()
    await createSupply(db, farm.id, 'Ureia', 25000)
    await expect(createSupply(db, farm.id, 'sal MINERAL', null)).rejects.toThrow(SupplyError)
    expect(await db.supplies.count()).toBe(5)
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

describe('mistura de sal', () => {
  async function mixSetup() {
    const base = await setup()
    const byName = (n: string) => base.supplies.find((s) => s.name === n)!
    const branco = byName('Sal branco')
    const mineral = byName('Sal mineral')
    const mix = byName('Mistura de sal')
    const stockOf = async (id: string) => supplyStock(await db.supplyMovements.toArray(), id)
    const buy = (supplyId: string, halves: number) =>
      recordSupplyMovement(db, base.farm.id, { supplyId, type: 'compra', date: addDays(todayLocal(), -3), halves, costCents: 10000, supplier: 'Loja' })
    const make = (batches: number, key?: string, authorize?: { reason: string }) =>
      recordMixture(db, base.farm.id, { mixtureId: mix.id, batches, date: todayLocal() }, key, authorize)
    return { ...base, branco, mineral, mix, stockOf, buy, make }
  }

  it('receita inicial: 3 sacos de branco + 1 de mineral rendem 6 sacos', async () => {
    const { mix, branco, mineral } = await mixSetup()
    expect(mix.recipe).toEqual([
      { supplyId: branco.id, halves: 6 },
      { supplyId: mineral.id, halves: 2 },
    ])
    expect(mix.yieldHalves).toBe(12)
    expect(recipeText(mix, new Map([[branco.id, 'Sal branco'], [mineral.id, 'Sal mineral']]))).toBe('3 sacos de Sal branco + 1 saco de Sal mineral → 6 sacos')
  })

  it('fazenda que já tinha Sal branco e mineral (v0.9.0) ganha a mistura sem duplicar', async () => {
    db = createDatabase(`test-${newId()}`)
    const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
    await createSupply(db, farm.id, 'Sal branco', null, `${farm.id}-insumo-sal-branco`)
    await createSupply(db, farm.id, 'Sal mineral', null, `${farm.id}-insumo-sal-mineral`)
    await ensureDefaultSupplies(db, farm.id)
    await ensureDefaultSupplies(db, farm.id)
    expect((await db.supplies.toArray()).map((s) => s.name).sort()).toEqual(['Mistura de sal', 'Sal branco', 'Sal mineral'])
  })

  it('mistura feita desconta branco e mineral e soma sacos de mistura', async () => {
    const { branco, mineral, mix, buy, make, stockOf, farm, pasture } = await mixSetup()
    await buy(branco.id, 20)
    await buy(mineral.id, 6)
    await make(2)
    expect(await stockOf(branco.id)).toBe(8)
    expect(await stockOf(mineral.id)).toBe(2)
    expect(await stockOf(mix.id)).toBe(24)
    await recordSupplyMovement(db, farm.id, { supplyId: mix.id, type: 'consumo', date: todayLocal(), halves: 3, pastureId: pasture.id })
    expect(await stockOf(mix.id)).toBe(21)
  })

  it('sal branco e mineral não são lançados direto no cocho; mistura não é comprada', async () => {
    const { branco, mix, farm, pasture, buy } = await mixSetup()
    await buy(branco.id, 4)
    await expect(recordSupplyMovement(db, farm.id, { supplyId: branco.id, type: 'consumo', date: todayLocal(), halves: 1, pastureId: pasture.id })).rejects.toThrow('Mistura de sal')
    await expect(recordSupplyMovement(db, farm.id, { supplyId: mix.id, type: 'compra', date: todayLocal(), halves: 1, costCents: 100, supplier: 'X' })).rejects.toThrow('não é comprada')
  })

  it('ingrediente insuficiente pede autorização', async () => {
    const { branco, mineral, buy, make, stockOf } = await mixSetup()
    await buy(branco.id, 20)
    await buy(mineral.id, 1)
    const err = await make(1).catch((e) => e)
    expect(err).toBeInstanceOf(NegativeStockError)
    expect(err.message).toContain('Sal mineral')
    expect((await db.supplyMovements.toArray()).filter((m) => m.type === 'mistura')).toHaveLength(0)
    await make(1, undefined, { reason: 'mineral chega amanhã' })
    expect(await stockOf(mineral.id)).toBe(-1)
    const movs = (await db.supplyMovements.toArray()).filter((m) => m.type === 'mistura')
    expect(movs.find((m) => m.supplyId === mineral.id)?.authorizedNegative).toBe(true)
    expect(movs.find((m) => m.supplyId === branco.id)?.authorizedNegative).toBe(false)
  })

  it('estorno de uma mistura estorna ingredientes e mistura juntos', async () => {
    const { branco, mineral, mix, buy, make, stockOf, farm, pasture } = await mixSetup()
    await buy(branco.id, 20)
    await buy(mineral.id, 6)
    await make(1)
    const brancoLine = (await db.supplyMovements.toArray()).find((m) => m.type === 'mistura' && m.supplyId === branco.id)!
    await reverseSupplyMovement(db, brancoLine.id, 'lançada duas vezes')
    expect(await stockOf(branco.id)).toBe(20)
    expect(await stockOf(mineral.id)).toBe(6)
    expect(await stockOf(mix.id)).toBe(0)
    expect((await db.supplyMovements.toArray()).filter((m) => m.type === 'mistura' && m.status === 'estornado')).toHaveLength(3)
    // mistura já usada no cocho não pode ser estornada
    await make(1)
    await recordSupplyMovement(db, farm.id, { supplyId: mix.id, type: 'consumo', date: todayLocal(), halves: 4, pastureId: pasture.id })
    const mixLine = (await db.supplyMovements.toArray()).find((m) => m.type === 'mistura' && m.supplyId === mix.id && m.status === 'ativo')!
    await expect(reverseSupplyMovement(db, mixLine.id, 'x')).rejects.toThrow('cocho')
  })

  it('o responsável define a própria receita; misturas antigas não mudam', async () => {
    const { branco, mineral, mix, buy, make, stockOf } = await mixSetup()
    await buy(branco.id, 40)
    await buy(mineral.id, 10)
    await make(1)
    await setRecipe(db, mix.id, [{ supplyId: branco.id, halves: 8 }, { supplyId: mineral.id, halves: 1 }], 14)
    await make(1)
    expect(await stockOf(branco.id)).toBe(40 - 6 - 8)
    expect(await stockOf(mineral.id)).toBe(10 - 2 - 1)
    expect(await stockOf(mix.id)).toBe(12 + 14)
    await expect(setRecipe(db, mix.id, [], 12)).rejects.toThrow('ingrediente')
    await expect(setRecipe(db, mix.id, [{ supplyId: mix.id, halves: 2 }], 12)).rejects.toThrow('inválido')
    await expect(setRecipe(db, mix.id, [{ supplyId: branco.id, halves: 2 }], 0)).rejects.toThrow('rende')
  })

  it('não duplica a mesma mistura (idempotência)', async () => {
    const { branco, mineral, mix, buy, make, stockOf } = await mixSetup()
    await buy(branco.id, 20)
    await buy(mineral.id, 6)
    const key = newId()
    await make(1, key)
    await make(1, key)
    expect(await stockOf(mix.id)).toBe(12)
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

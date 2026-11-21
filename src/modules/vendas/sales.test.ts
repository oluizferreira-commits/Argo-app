import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { formatMoney, parseDecimal, parseMoney } from '../../core/money'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { balanceOf, computeBalances, entriesIn, recordMovement, reverseMovement, todayLocal } from '../rebanho/herd'
import { buildInstallments, cancelSale, computeTotals, createClient, createSale, type SaleInput } from './sales'

let db: ArgoDatabase
afterEach(async () => db?.delete())

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'Fazenda Teste', responsible: '', city: '' }, '')
  const p = await createPasture(db, farm.id, { name: 'Pasto 1', areaHa: null, notes: '' })
  await recordMovement(db, { type: 'compra', date: todayLocal(), notes: '', entries: entriesIn(p.id, { boi: 30, vaca: 10 }) })
  const client = await createClient(db, farm.id, { name: 'Cliente Teste', phone: '', city: '', document: '' })
  const bal = async () => computeBalances(await db.movements.toArray())
  return { farm, p, client, bal }
}

const base = (clientId: string): Omit<SaleInput, 'mode' | 'items' | 'weighing' | 'animals' | 'pricePerArrobaCents' | 'pricePerHeadCents' | 'installments'> => ({
  date: todayLocal(),
  clientId,
  paymentKind: 'avista',
  notes: '',
})

describe('dinheiro e números', () => {
  it('lê valores no formato brasileiro', () => {
    expect(parseMoney('2.500')).toBe(250000)
    expect(parseMoney('2500,5')).toBe(250050)
    expect(parseMoney('R$ 1.234,56')).toBe(123456)
    expect(parseMoney('abc')).toBeNull()
    expect(parseDecimal('487,5', 1)).toBe(4875)
    expect(parseDecimal('16,25', 2)).toBe(1625)
    expect(parseDecimal('16,255', 2)).toBeNull()
    expect(formatMoney(650000).replace(/\s/g, ' ')).toBe('R$ 6.500,00')
  })
})

describe('cálculo da venda', () => {
  it('peso vivo: kg ÷ 30 = arrobas', () => {
    const t = computeTotals({ mode: 'arroba', weighing: 'vivo', animals: [{ pastureId: 'p', category: 'boi', amount: 6000 }], pricePerArrobaCents: 30000, pricePerHeadCents: {}, items: [] })
    expect(t).toEqual({ arrobasHundredths: 2000, totalCents: 600000 })
  })

  it('peso vivo com frações soma o peso exato antes de arredondar', () => {
    // 487 kg + 513,5 kg = 1000,5 kg → 33,35 @ ; × R$ 310,00 = R$ 10.338,50
    const t = computeTotals({
      mode: 'arroba',
      weighing: 'vivo',
      animals: [
        { pastureId: 'p', category: 'boi', amount: 4870 },
        { pastureId: 'p', category: 'boi', amount: 5135 },
      ],
      pricePerArrobaCents: 31000,
      pricePerHeadCents: {},
      items: [],
    })
    expect(t).toEqual({ arrobasHundredths: 3335, totalCents: 1033850 })
  })

  it('abate: arrobas lançadas direto', () => {
    const t = computeTotals({ mode: 'arroba', weighing: 'carcaca', animals: [{ pastureId: 'p', category: 'vaca', amount: 1050 }], pricePerArrobaCents: 28000, pricePerHeadCents: {}, items: [] })
    expect(t).toEqual({ arrobasHundredths: 1050, totalCents: 294000 })
  })

  it('por cabeça: 20 × R$ 2.500 = R$ 50.000', () => {
    const t = computeTotals({ mode: 'cabeca', weighing: null, animals: [], pricePerArrobaCents: null, pricePerHeadCents: { boi: 250000 }, items: [{ pastureId: 'p', category: 'boi', quantity: 20 }] })
    expect(t.totalCents).toBe(5000000)
  })

  it('parcelas somam exatamente o total', () => {
    const p = buildInstallments('parcelado', '2026-11-21', 10000, { count: 3, intervalDays: 30 })
    expect(p.map((x) => x.amountCents)).toEqual([3334, 3333, 3333])
    expect(p.map((x) => x.due)).toEqual(['2026-12-21', '2027-01-20', '2027-02-19'])
    expect(buildInstallments('prazo', '2026-11-21', 500, { days: 15 })).toEqual([{ due: '2026-12-06', amountCents: 500 }])
    expect(buildInstallments('avista', '2026-11-21', 500)).toEqual([{ due: '2026-11-21', amountCents: 500 }])
  })
})

describe('venda e rebanho', () => {
  it('venda por cabeça dá baixa no rebanho e numera por fazenda', async () => {
    const { farm, p, client, bal } = await setup()
    const s = await createSale(db, farm.id, {
      ...base(client.id),
      mode: 'cabeca',
      items: [{ pastureId: p.id, category: 'boi', quantity: 20 }],
      weighing: null,
      animals: [],
      pricePerArrobaCents: null,
      pricePerHeadCents: { boi: 250000 },
      installments: buildInstallments('avista', todayLocal(), 5000000),
    })
    expect(s.number).toBe(1)
    expect(s.totalCents).toBe(5000000)
    expect(balanceOf(await bal(), p.id, 'boi')).toBe(10)
    const m = await db.movements.get(s.movementId)
    expect(m).toMatchObject({ type: 'venda', saleId: s.id })
  })

  it('venda por arroba (peso vivo) com venda mista', async () => {
    const { farm, p, client, bal } = await setup()
    const animals = [
      { pastureId: p.id, category: 'boi' as const, amount: 6000 },
      { pastureId: p.id, category: 'vaca' as const, amount: 4500 },
    ]
    const s = await createSale(db, farm.id, {
      ...base(client.id),
      mode: 'arroba',
      items: [],
      weighing: 'vivo',
      animals,
      pricePerArrobaCents: 30000,
      pricePerHeadCents: {},
      installments: buildInstallments('prazo', todayLocal(), 1050000, { days: 30 }),
    })
    expect(s.arrobasHundredths).toBe(3500)
    expect(s.totalCents).toBe(1050000)
    expect(s.items).toHaveLength(2)
    const b = await bal()
    expect(balanceOf(b, p.id, 'boi')).toBe(29)
    expect(balanceOf(b, p.id, 'vaca')).toBe(9)
  })

  it('não vende mais animais do que o pasto tem — e nada é gravado', async () => {
    const { farm, p, client } = await setup()
    await expect(
      createSale(db, farm.id, {
        ...base(client.id),
        mode: 'cabeca',
        items: [{ pastureId: p.id, category: 'boi', quantity: 31 }],
        weighing: null,
        animals: [],
        pricePerArrobaCents: null,
        pricePerHeadCents: { boi: 100000 },
        installments: buildInstallments('avista', todayLocal(), 3100000),
      }),
    ).rejects.toThrow(/Saldo insuficiente/)
    expect(await db.sales.count()).toBe(0)
    expect(await db.movements.where('type').equals('venda').count()).toBe(0)
  })

  it('parcelas que não fecham com o total são recusadas', async () => {
    const { farm, p, client } = await setup()
    await expect(
      createSale(db, farm.id, {
        ...base(client.id),
        mode: 'cabeca',
        items: [{ pastureId: p.id, category: 'boi', quantity: 1 }],
        weighing: null,
        animals: [],
        pricePerArrobaCents: null,
        pricePerHeadCents: { boi: 100000 },
        installments: [{ due: todayLocal(), amountCents: 99999 }],
      }),
    ).rejects.toThrow(/soma das parcelas/)
  })

  it('cancelar devolve os animais; estorno avulso da saída é bloqueado', async () => {
    const { farm, p, client, bal } = await setup()
    const s = await createSale(db, farm.id, {
      ...base(client.id),
      mode: 'cabeca',
      items: [{ pastureId: p.id, category: 'vaca', quantity: 4 }],
      weighing: null,
      animals: [],
      pricePerArrobaCents: null,
      pricePerHeadCents: { vaca: 300000 },
      installments: buildInstallments('avista', todayLocal(), 1200000),
    })
    await expect(reverseMovement(db, s.movementId, '')).rejects.toThrow(/cancele a venda/)
    const c = await cancelSale(db, s.id, 'desistiu')
    expect(c.status).toBe('cancelada')
    expect(balanceOf(await bal(), p.id, 'vaca')).toBe(10)
    await expect(cancelSale(db, s.id, '')).rejects.toThrow(/já foi cancelada/)
  })

  it('venda repetida (toque duplo) não duplica', async () => {
    const { farm, p, client, bal } = await setup()
    const key = newId()
    const input: SaleInput = {
      ...base(client.id),
      mode: 'cabeca',
      items: [{ pastureId: p.id, category: 'boi', quantity: 2 }],
      weighing: null,
      animals: [],
      pricePerArrobaCents: null,
      pricePerHeadCents: { boi: 100000 },
      installments: buildInstallments('avista', todayLocal(), 200000),
    }
    await Promise.all([createSale(db, farm.id, input, key), createSale(db, farm.id, input, key)])
    expect(await db.sales.count()).toBe(1)
    expect(balanceOf(await bal(), p.id, 'boi')).toBe(28)
  })

  it('cliente: CPF inválido recusado, nome único por fazenda', async () => {
    const { farm } = await setup()
    await expect(createClient(db, farm.id, { name: 'X', phone: '', city: '', document: '123.456.789-00' })).rejects.toThrow(/inválido/)
    await expect(createClient(db, farm.id, { name: 'cliente teste', phone: '', city: '', document: '' })).rejects.toThrow(/Já existe/)
    const ok = await createClient(db, farm.id, { name: 'Y', phone: '', city: '', document: '529.982.247-25' })
    expect(ok.document).toBe('52998224725')
  })
})

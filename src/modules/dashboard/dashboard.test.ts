import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createEquipment, recordFuelMovement, reverseFuelMovement } from '../diesel/fuel'
import { createFarm } from '../fazendas/farms'
import { ensureDefaultSupplies, recordMixture, recordSupplyMovement } from '../insumos/supplies'
import { addTask, createPasture, setTaskDone } from '../pastos/pastures'
import { entriesIn, recordMovement, todayLocal } from '../rebanho/herd'
import { recordPayment } from '../receber/receivables'
import { addDays, buildInstallments, createClient, createSale } from '../vendas/sales'
import { computeAgenda, computeIndicators, computePendencies, recentActivities, type DashboardData } from './dashboard'

let db: ArgoDatabase
afterEach(async () => db?.delete())

const today = todayLocal()
const monthStart = `${today.slice(0, 7)}-01`

async function load(farmId: string): Promise<DashboardData> {
  const f = farmId
  return {
    farm: (await db.farms.get(f))!,
    pastures: await db.pastures.where('farmId').equals(f).toArray(),
    movements: await db.movements.where('farmId').equals(f).toArray(),
    sales: await db.sales.where('farmId').equals(f).toArray(),
    payments: await db.payments.where('farmId').equals(f).toArray(),
    clients: await db.clients.where('farmId').equals(f).toArray(),
    reserveEntries: await db.reserveEntries.where('farmId').equals(f).toArray(),
    supplies: await db.supplies.where('farmId').equals(f).toArray(),
    supplyMovements: await db.supplyMovements.where('farmId').equals(f).toArray(),
    fuelMovements: await db.fuelMovements.where('farmId').equals(f).toArray(),
    equipments: await db.equipments.where('farmId').equals(f).toArray(),
    tasks: await db.pastureTasks.where('farmId').equals(f).toArray(),
    audit: await db.auditLog.orderBy('at').reverse().limit(80).toArray(),
  }
}

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'Fazenda', responsible: '', city: '' }, '')
  const a = await createPasture(db, farm.id, { name: 'Pasto A', areaHa: null, notes: '' })
  const b = await createPasture(db, farm.id, { name: 'Pasto B', areaHa: null, notes: '' })
  await createPasture(db, farm.id, { name: 'Pasto C', areaHa: null, notes: '' })
  await recordMovement(db, { type: 'compra', date: addDays(today, -60), notes: '', entries: entriesIn(a.id, { boi: 10 }) })
  await recordMovement(db, { type: 'contagem', date: addDays(today, -50), notes: '', entries: [{ pastureId: b.id, category: 'femea-a-especificar', delta: 20, reason: 'saldo-inicial' }] })
  const client = await createClient(db, farm.id, { name: 'João', phone: '', city: '', document: '' })
  const sale = (date: string, heads: number, price: number, days: number) =>
    createSale(db, farm.id, {
      date,
      clientId: client.id,
      mode: 'cabeca',
      items: [{ pastureId: a.id, category: 'boi', quantity: heads }],
      weighing: null,
      animals: [],
      pricePerArrobaCents: null,
      pricePerHeadCents: { boi: price },
      paymentKind: 'prazo',
      installments: buildInstallments('prazo', date, heads * price, { days }),
      notes: '',
    })
  return { farm, a, b, client, sale }
}

describe('indicadores', () => {
  it('usa só dados reais e considera recebimentos parciais', async () => {
    const { farm, sale } = await setup()
    // venda de 2 bois a R$ 3.000 = R$ 6.000, vence em 10 dias; recebido R$ 1.000 (parcial) hoje
    const s = await sale(addDays(today, -20), 2, 300000, 30)
    await recordPayment(db, farm.id, { saleId: s.id, date: today, amountCents: 100000, method: 'pix', notes: '' })
    // compras: diesel no mês R$ 600 (+ uma estornada), sal no mês R$ 150, diesel de mês passado não entra
    const eq = await createEquipment(db, farm.id, { name: 'Trator', type: '', identification: '', responsibleId: null, meter: 'nenhum' })
    void eq
    await recordFuelMovement(db, farm.id, { type: 'compra', date: monthStart, centiliters: 10000, totalCents: 60000, station: 'Posto' })
    const x = await recordFuelMovement(db, farm.id, { type: 'compra', date: monthStart, centiliters: 10000, totalCents: 99999, station: 'Posto' })
    await reverseFuelMovement(db, x.id, 'errado')
    await recordFuelMovement(db, farm.id, { type: 'compra', date: addDays(monthStart, -1), centiliters: 10000, totalCents: 70000, station: 'Posto' })
    await ensureDefaultSupplies(db, farm.id)
    const branco = (await db.supplies.toArray()).find((z) => z.name === 'Sal branco')!
    await recordSupplyMovement(db, farm.id, { supplyId: branco.id, type: 'compra', date: monthStart, halves: 2, costCents: 15000, supplier: 'Loja' })

    const ind = computeIndicators(await load(farm.id), today)
    expect(ind.animals).toBe(10 - 2 + 20)
    expect(ind.pastures).toBe(3)
    expect(ind.occupiedPastures).toBe(2)
    expect(ind.openCents).toBe(500000) // R$ 6.000 − R$ 1.000 recebido
    expect(ind.overdueCents).toBe(0)
    expect(ind.receivedMonthCents).toBe(100000)
    expect(ind.fuelExpenseCents).toBe(60000)
    expect(ind.supplyExpenseCents).toBe(15000)
    expect(ind.expensesMonthCents).toBe(75000)
    expect(ind.reserveCents).toBe(0) // nada depositado: a receber não entra no saldo
    expect(ind.reservePendingCents).toBe(35000)
  })
})

describe('Central de Pendências', () => {
  it('sem dados que justifiquem, não há pendência', async () => {
    db = createDatabase(`test-${newId()}`)
    const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
    await createPasture(db, farm.id, { name: 'P', areaHa: null, notes: '' })
    expect(computePendencies(await load(farm.id), today)).toEqual([])
  })

  it('reúne vencidas, estoque negativo, especificação e reserva, sem duplicar, por prioridade', async () => {
    const { farm, b, sale } = await setup()
    const s = await sale(addDays(today, -40), 1, 400000, 30) // venceu há 10 dias
    await recordPayment(db, farm.id, { saleId: s.id, date: addDays(today, -5), amountCents: 100000, method: 'pix', notes: '' })
    await ensureDefaultSupplies(db, farm.id)
    const mix = (await db.supplies.toArray()).find((z) => z.name === 'Mistura de sal')!
    await recordMixture(db, farm.id, { mixtureId: mix.id, batches: 1, date: today }, undefined, { reason: 'teste' })
    const list = computePendencies(await load(farm.id), today)
    const ids = list.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(`vencida:${s.id}`)
    expect(ids).toContain(`especificar:${b.id}`)
    expect(ids).toContain('reserva')
    expect(ids.filter((i) => i.startsWith('estoque:'))).toHaveLength(2) // sal branco e mineral negativos
    expect(list.map((p) => p.priority)).toEqual([...list.map((p) => p.priority)].sort())
    const venc = list.find((p) => p.id === `vencida:${s.id}`)!
    expect(venc.detail).toContain('R$')
    expect(venc.to).toBe(`/vendas/${s.id}`)
    expect(list.find((p) => p.id === `especificar:${b.id}`)!.detail).toBe('20 fêmeas sem categoria')
  })

  it('pendência some quando é resolvida', async () => {
    const { farm, sale } = await setup()
    const s = await sale(addDays(today, -40), 1, 400000, 30)
    expect(computePendencies(await load(farm.id), today).some((p) => p.id === `vencida:${s.id}`)).toBe(true)
    await recordPayment(db, farm.id, { saleId: s.id, date: today, amountCents: 400000, method: 'pix', notes: '' })
    expect(computePendencies(await load(farm.id), today).some((p) => p.id === `vencida:${s.id}`)).toBe(false)
  })
})

describe('Agenda Operacional', () => {
  it('parcelas atrasadas, de hoje e dos próximos 15 dias; serviços dos pastos', async () => {
    const { farm, a, sale } = await setup()
    const late = await sale(addDays(today, -40), 1, 100000, 30)
    const now = await sale(addDays(today, -30), 1, 100000, 30)
    const soon = await sale(addDays(today, -25), 1, 100000, 30)
    const far = await sale(today, 1, 100000, 60)
    const t1 = await addTask(db, a.id, 'Arrumar cerca', newId(), '')
    const t2 = await addTask(db, a.id, 'Limpar bebedouro', newId(), '')
    await setTaskDone(db, t2.id, true)
    const ag = computeAgenda(await load(farm.id), today)
    const byId = new Map(ag.map((i) => [i.id, i]))
    expect(byId.get(`parcela:${late.id}:0`)?.status).toBe('atrasada')
    expect(byId.get(`parcela:${now.id}:0`)?.group).toBe('hoje')
    expect(byId.get(`parcela:${soon.id}:0`)?.group).toBe('proximos')
    expect(byId.has(`parcela:${far.id}:0`)).toBe(false)
    expect(byId.get(`tarefa:${t1.id}`)?.status).toBe('pendente')
    expect(byId.get(`tarefa:${t2.id}`)?.status).toBe('concluida')
    expect(ag.map((i) => i.group)).toEqual(['atrasadas', 'hoje', 'proximos', 'sem-data', 'concluidas'])
  })
})

describe('Atividades recentes', () => {
  it('descreve os últimos lançamentos da fazenda e junta a mistura num item só', async () => {
    const { farm, sale } = await setup()
    await sale(today, 1, 250000, 30)
    await ensureDefaultSupplies(db, farm.id)
    const mix = (await db.supplies.toArray()).find((z) => z.name === 'Mistura de sal')!
    await recordMixture(db, farm.id, { mixtureId: mix.id, batches: 1, date: today }, undefined, { reason: 'teste' })
    const other = await createFarm(db, { name: 'Outra', responsible: '', city: '' }, '')
    await createPasture(db, other.id, { name: 'Pasto da outra', areaHa: null, notes: '' })
    const d = await load(farm.id)
    const acts = recentActivities(d.audit, d, 10)
    const texts = acts.map((x) => x.text)
    expect(texts.filter((t) => t.startsWith('Mistura feita'))).toHaveLength(1)
    expect(texts.some((t) => t.startsWith('Venda nº'))).toBe(true)
    expect(texts.some((t) => t.includes('Pasto da outra'))).toBe(false)
  })
})

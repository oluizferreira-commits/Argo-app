import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { entriesCount, entriesIn, entriesOut, recordMovement, reverseMovement, todayLocal, computeBalances } from '../rebanho/herd'
import { recordPayment } from '../receber/receivables'
import { recordReserveEntry } from '../reserva/reserve'
import { addDays, buildInstallments, createClient, createSale } from '../vendas/sales'
import { buildReports, periodLabel, periodRange, referenceDate, type Period, type ReportData } from './reports'

let db: ArgoDatabase
afterEach(async () => db?.delete())

const T = (s: string) => s.replace(/ /g, ' ')

describe('período', () => {
  it('mês e ano', () => {
    expect(periodRange({ kind: 'mes', year: 2026, month: 2 })).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(periodRange({ kind: 'mes', year: 2028, month: 2 })).toEqual({ start: '2028-02-01', end: '2028-02-29' })
    expect(periodRange({ kind: 'ano', year: 2026 })).toEqual({ start: '2026-01-01', end: '2026-12-31' })
    expect(periodLabel({ kind: 'mes', year: 2026, month: 3 })).toBe('Março de 2026')
    expect(referenceDate({ kind: 'ano', year: 2026 }, '2026-11-21')).toBe('2026-11-21')
    expect(referenceDate({ kind: 'mes', year: 2026, month: 10 }, '2026-11-21')).toBe('2026-10-31')
  })
})

describe('relatórios', () => {
  async function scenario() {
    db = createDatabase(`test-${newId()}`)
    const today = todayLocal()
    const year = Number(today.slice(0, 4))
    const farm = await createFarm(db, { name: 'Fazenda Teste', responsible: '', city: '' }, '')
    const a = await createPasture(db, farm.id, { name: 'Pasto A', areaHa: 10, notes: '' })
    const day = (off: number) => addDays(today, off)
    await recordMovement(db, { type: 'compra', date: day(-200), notes: '', entries: entriesIn(a.id, { boi: 20, vaca: 10 }) })
    await recordMovement(db, { type: 'nascimento', date: day(-5), notes: 'parto', entries: entriesIn(a.id, { bezerra: 2 }) })
    await recordMovement(db, { type: 'morte', date: day(-4), notes: 'raio', entries: entriesOut(a.id, { vaca: 1 }) })
    const bal = computeBalances(await db.movements.toArray())
    await recordMovement(db, { type: 'contagem', date: day(-3), notes: '', entries: entriesCount(a.id, { bezerro: 3 }, bal, { bezerro: 'nascimento-nao-registrado' }) })
    const wrong = await recordMovement(db, { type: 'nascimento', date: day(-2), notes: 'errado', entries: entriesIn(a.id, { bezerro: 9 }) })
    await reverseMovement(db, wrong.id, 'errado')
    const c = await createClient(db, farm.id, { name: 'Cliente A', phone: '', city: '', document: '' })
    const s1 = await createSale(db, farm.id, {
      date: day(-60),
      clientId: c.id,
      mode: 'arroba',
      items: [],
      weighing: 'vivo',
      animals: [{ pastureId: a.id, category: 'boi', amount: 6000 }, { pastureId: a.id, category: 'boi', amount: 4500 }],
      pricePerArrobaCents: 30000,
      pricePerHeadCents: {},
      paymentKind: 'parcelado',
      installments: buildInstallments('parcelado', day(-60), 1050000, { count: 2, intervalDays: 30 }),
      notes: '',
    })
    await recordPayment(db, farm.id, { saleId: s1.id, date: day(-1), amountCents: 300000, method: 'pix', notes: '' })
    await recordReserveEntry(db, farm.id, { type: 'deposito', date: day(-1), amountCents: 105000, notes: 'Transferência dos 35%' })
    await recordReserveEntry(db, farm.id, { type: 'retirada', date: day(0), amountCents: 5000, notes: 'Sal mineral' })
    const data: ReportData = {
      farm,
      pastures: await db.pastures.toArray(),
      movements: await db.movements.toArray(),
      sales: await db.sales.toArray(),
      payments: await db.payments.toArray(),
      clients: await db.clients.toArray(),
      reserveEntries: await db.reserveEntries.toArray(),
      today,
    }
    return { data, year, s1 }
  }

  it('ano: vendas, arrobas, recebimentos, inadimplência, reserva, nascimentos/mortes e rebanho', async () => {
    const { data, year } = await scenario()
    const p: Period = { kind: 'ano', year }
    const [v, ar, rec, ina, res, nm, reb] = buildReports(['vendas', 'arrobas', 'recebimentos', 'inadimplencia', 'reserva', 'nascimentos-mortes', 'rebanho'], data, p)
    const sum = (r: typeof v) => Object.fromEntries(r.summary.map((x) => [x.label, T(x.value)]))
    // pode atravessar a virada do ano em datas relativas; os testes só usam valores quando no mesmo ano
    if (addDays(data.today!, -200).slice(0, 4) === String(year) && addDays(data.today!, -60).slice(0, 4) === String(year)) {
      expect(sum(v)['Valor total']).toBe('R$ 10.500,00')
      // relatório anual de vendas: mês a mês e por cliente (soma = 100%)
      expect(v.tables.map((t) => t.title)).toEqual(['Por mês', 'Por cliente', undefined])
      const porCliente = v.tables[1]
      expect(porCliente.rows.map((r) => r[4]).reduce((a, x) => a + Number(x.replace('%', '').replace(',', '.')), 0)).toBeCloseTo(100, 0)
      expect(sum(ar)).toMatchObject({ 'Arrobas vendidas': '35,00 @', 'Preço médio': 'R$ 300,00/@' })
      expect(sum(ina)['Total vencido']).toBe('R$ 2.250,00') // parcela 1 (R$ 5.250) − R$ 3.000 recebidos
    }
    expect(sum(rec)['Total recebido']).toBe('R$ 3.000,00')
    expect(sum(rec)['Parte da reserva']).toBe('R$ 1.050,00')
    expect(sum(res)).toMatchObject({ Depósitos: 'R$ 1.050,00', Retiradas: 'R$ 50,00', 'Saldo final': 'R$ 1.000,00' })
    expect(sum(nm)).toMatchObject({ Nascimentos: '5', Mortes: '1' }) // 2 lançados + 3 na contagem; estornado não entra
    expect(nm.tables[1].rows.some((r) => r[5] === 'Encontrado na contagem')).toBe(true)
    expect(sum(reb)['Total de cabeças']).toBe('32') // 30 + 2 + 3 − 1 − 2 vendidos (estorno fora)
  })

  it('mês sem movimento mostra vazio', async () => {
    const { data, year } = await scenario()
    const [v, rec] = buildReports(['vendas', 'recebimentos'], data, { kind: 'mes', year: year - 3, month: 1 })
    expect(v.empty).toBe('Nenhuma venda no período.')
    expect(rec.empty).toBe('Nenhum recebimento no período.')
  })
})

describe('texto do PDF', () => {
  it('mantém acentos do português e troca caracteres fora das fontes do PDF', async () => {
    const { pdfText } = await import('./pdf')
    expect(pdfText('Gestão Pecuária: ação, café, ônibus')).toBe('Gestão Pecuária: ação, café, ônibus')
    expect(pdfText('a — b − c “d” …')).toBe('a - b - c "d" ...')
    expect(pdfText('ok ✓')).toBe('ok ')
  })
})

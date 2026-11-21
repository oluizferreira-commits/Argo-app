import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { buildReports, weekStart, type Period, type ReportData } from '../relatorios/reports'
import { createResponsible } from '../responsaveis/responsibles'
import { createEquipment, recordFuelMovement } from './fuel'

let db: ArgoDatabase
afterEach(async () => db?.delete())

describe('relatório do diesel', () => {
  it('semana começa na segunda', () => {
    expect(weekStart('2026-11-01')).toBe('2026-10-26') // domingo
    expect(weekStart('2026-11-02')).toBe('2026-11-02') // segunda
    expect(weekStart('2026-11-07')).toBe('2026-11-02')
  })

  it('por semana, equipamento (L/h e km/L), responsável e custo médio', async () => {
    db = createDatabase(`test-${newId()}`)
    const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
    const ze = await createResponsible(db, farm.id, 'Zé', '')
    const joao = await createResponsible(db, farm.id, 'João', '')
    const trator = await createEquipment(db, farm.id, { name: 'Trator', type: '', identification: '', responsibleId: ze.id, meter: 'horimetro' })
    const hilux = await createEquipment(db, farm.id, { name: 'Hilux', type: '', identification: '', responsibleId: joao.id, meter: 'km' })
    const buy = (date: string, l: number, reais: number) => recordFuelMovement(db, farm.id, { type: 'compra', date, centiliters: l * 100, totalCents: reais * 100, station: 'Posto' })
    const use = (date: string, eq: string, resp: string, l: number, meter: number) =>
      recordFuelMovement(db, farm.id, { type: 'consumo', date, centiliters: l * 100, equipmentId: eq, responsibleId: resp, meterReading: meter * 10 })
    await buy('2026-09-30', 1000, 6000) // antes do período: R$ 6,00/L
    await use('2026-10-01', trator.id, ze.id, 50, 1000) // primeira leitura (sem intervalo)
    await use('2026-10-06', trator.id, ze.id, 60, 1010) // 10 h → 6 L/h
    await use('2026-10-13', trator.id, ze.id, 40, 1020) // 10 h
    await use('2026-10-06', hilux.id, joao.id, 30, 5000)
    await use('2026-10-14', hilux.id, joao.id, 40, 5400) // 400 km / 40 L = 10 km/L
    const data: ReportData = {
      farm: (await db.farms.get(farm.id))!,
      pastures: [],
      movements: [],
      sales: [],
      payments: [],
      clients: [],
      reserveEntries: [],
      fuelMovements: await db.fuelMovements.toArray(),
      equipments: await db.equipments.toArray(),
      responsibles: await db.responsibles.toArray(),
    }
    const p: Period = { kind: 'mes', year: 2026, month: 10 }
    const [r] = buildReports(['diesel'], data, p)
    const sum = Object.fromEntries(r.summary.map((x) => [x.label, x.value.replace(/ /g, ' ')]))
    expect(sum['Consumido']).toBe('220 L')
    expect(sum['Custo do consumo']).toBe('R$ 1.320,00')
    expect(sum['Estoque no fim']).toBe('780 L')
    expect(sum['Custo médio no fim']).toBe('R$ 6,00/L')
    const [semana, porEq, porResp, compras] = r.tables
    expect(semana.rows.map((x) => x[0])).toEqual(['28/09 a 04/10', '05/10 a 11/10', '12/10 a 18/10'])
    expect(semana.rows.map((x) => x[2])).toEqual(['50 L', '90 L', '80 L'])
    const trow = porEq.rows.find((x) => x[0] === 'Trator')!
    expect(trow.slice(1)).toEqual(['3', '150 L', 'R$ 900,00'.replace(' ', ' '), '20,0 h', '5,00 L/h'])
    const hrow = porEq.rows.find((x) => x[0] === 'Hilux')!
    expect(hrow.slice(4)).toEqual(['400,0 km', '10,00 km/L'])
    expect(porResp.rows.map((x) => [x[0], x[2]])).toEqual([
      ['João', '70 L'],
      ['Zé', '150 L'],
    ])
    expect(compras.rows).toHaveLength(0) // compra foi antes do período

    const [ano] = buildReports(['diesel'], data, { kind: 'ano', year: 2026 })
    expect(ano.tables[0].title).toBe('Por mês')
    expect(ano.tables[0].rows.map((x) => x[0])).toEqual(['Outubro'])
    expect(ano.tables[3].rows).toHaveLength(1)
  })

  it('período sem diesel mostra aviso', () => {
    const [r] = buildReports(['diesel'], { farm: { reserveRates: [] } as never, pastures: [], movements: [], sales: [], payments: [], clients: [], reserveEntries: [] }, { kind: 'mes', year: 2026, month: 1 })
    expect(r.empty).toContain('Nenhuma compra')
  })
})

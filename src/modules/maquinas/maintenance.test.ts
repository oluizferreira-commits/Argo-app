import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createEquipment } from '../diesel/fuel'
import { createFarm } from '../fazendas/farms'
import { createSupply, recordSupplyMovement, reverseSupplyMovement, supplyStock } from '../insumos/supplies'
import { todayLocal } from '../rebanho/herd'
import { addDays } from '../vendas/sales'
import { endSession, loadMeterContext, meterAt, startService } from './machines'
import { cancelMaintenance, createPlan, MaintenanceError, planStatus, recordMaintenance, saveChecklist, type PlanInput } from './maintenance'

let db: ArgoDatabase
afterEach(async () => db?.delete())
const today = todayLocal()
const D = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const T = (hhmm: string) => `${D}T${hhmm}:00.000Z`

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
  const jd = await createEquipment(db, farm.id, { name: 'JD 7230J', type: 'Trator', identification: '', responsibleId: null, meter: 'horimetro', meterInitial: 124000 })
  const plan = (p: Partial<PlanInput>) =>
    createPlan(db, farm.id, { equipmentId: jd.id, name: 'Troca de óleo do motor', intervalHours: null, intervalDays: null, warnHours: null, warnDays: null, baselineDate: null, baselineMeter: null, notes: '', ...p })
  const meter = async () => meterAt((await db.equipments.get(jd.id))!, await loadMeterContext(db, farm.id))
  const records = () => db.maintenanceRecords.toArray()
  return { farm, jd, plan, meter, records }
}

describe('manutenção programada', () => {
  it('troca de óleo a cada 250 h: 1.000 → próxima 1.250; aviso 10 h antes; vencida', async () => {
    const { farm, jd, plan, records } = await setup()
    const p = await plan({ intervalHours: 25000, warnHours: 1000, baselineMeter: 100000 })
    expect(planStatus(p, await records(), 123000)).toMatchObject({ nextMeter: 125000, hoursLeft: 2000, state: 'ok' })
    expect(planStatus(p, await records(), 124100).state).toBe('proximo') // faltam 9 h
    expect(planStatus(p, await records(), 125000).state).toBe('vencido')
    // horímetro sobe pelo trabalho do trator
    const sid = await startService(db, farm.id, { serviceType: 'rocada', customType: '', pastureId: null, location: 'Sede', machines: [{ equipmentId: jd.id, responsibleId: null }], notes: '' }, undefined, T('07:00'))
    const [s] = await db.machineSessions.where('serviceId').equals(sid).toArray()
    await endSession(db, s.id, T('17:00')) // 10 h → 1.250 h
    const cur = meterAt((await db.equipments.get(jd.id))!, await loadMeterContext(db, farm.id))
    expect(cur).toBe(125000)
    expect(planStatus(p, await records(), cur).state).toBe('vencido')
    // troca feita: próxima = 1.500 h
    await recordMaintenance(db, farm.id, { equipmentId: jd.id, planId: p.id, kind: p.name, date: today, meter: null, responsibleId: null, parts: [], serviceCents: 0, notes: '' })
    expect(planStatus(p, await records(), cur)).toMatchObject({ lastMeter: 125000, nextMeter: 150000, state: 'ok' })
  })

  it('lubrificação a cada 15 dias: 21/11 → 06/12, aviso 3 dias antes', async () => {
    const { plan, records } = await setup()
    const p = await plan({ name: 'Lubrificação', intervalDays: 15, warnDays: 3, baselineDate: '2026-11-21' })
    expect(planStatus(p, await records(), null, '2026-11-25')).toMatchObject({ nextDate: '2026-12-06', daysLeft: 11, state: 'ok' })
    expect(planStatus(p, await records(), null, '2026-12-03').state).toBe('proximo')
    expect(planStatus(p, await records(), null, '2026-12-07').state).toBe('vencido')
  })

  it('horas OU data: vale o que vencer primeiro', async () => {
    const { plan, records } = await setup()
    const p = await plan({ name: 'Revisão geral', intervalHours: 50000, intervalDays: 180, baselineMeter: 120000, baselineDate: addDays(today, -200) })
    expect(planStatus(p, await records(), 121000).state).toBe('vencido') // venceu pela data
  })

  it('peças do estoque dão baixa (custo médio, sem nova despesa); comprada direto + serviço = despesa; cancelar devolve', async () => {
    const { farm, jd, records } = await setup()
    const oleo = await createSupply(db, farm.id, 'Óleo 15W40', null, undefined, undefined, { category: 'geral', unit: 'L' })
    await recordSupplyMovement(db, farm.id, { supplyId: oleo.id, type: 'compra', date: addDays(today, -5), qty: 20000, costCents: 60000, supplier: 'Loja' }) // R$ 30/L
    const r = await recordMaintenance(db, farm.id, {
      equipmentId: jd.id,
      planId: null,
      kind: 'Troca de óleo do motor',
      date: today,
      meter: null,
      responsibleId: null,
      parts: [
        { supplyId: oleo.id, description: '', qty: 12000, costCents: null },
        { supplyId: null, description: 'Filtro de óleo', qty: null, costCents: 8500 },
      ],
      serviceCents: 15000,
      notes: '',
    })
    expect(r).toMatchObject({ stockCents: 36000, directCents: 23500, meter: 124000 })
    expect(supplyStock(await db.supplyMovements.toArray(), oleo.id)).toBe(8000)
    await expect(reverseSupplyMovement(db, r.parts[0].movementId!, 'x')).rejects.toThrow('manutenção')
    await cancelMaintenance(db, r.id, 'lançada na máquina errada')
    expect(supplyStock(await db.supplyMovements.toArray(), oleo.id)).toBe(20000)
    expect((await records())[0].status).toBe('cancelada')
  })
})

describe('checklist diário', () => {
  it('só grava com todos os itens; problema abre solicitação ligada; concluir a solicitação', async () => {
    const { farm, jd, records } = await setup()
    const items = [
      { label: 'Nível do óleo do motor', status: 'ok' as const, note: '' },
      { label: 'Pneus', status: '' as const, note: '' },
    ]
    await expect(saveChecklist(db, farm.id, { equipmentId: jd.id, responsibleId: null, items, photos: [], notes: '', openRequest: false })).rejects.toThrow('faltam 1: Pneus')
    const c = await saveChecklist(db, farm.id, { equipmentId: jd.id, responsibleId: null, items: [items[0], { label: 'Pneus', status: 'problema', note: 'traseiro furado' }], photos: ['data:image/jpeg;base64,AAA'], notes: '', openRequest: true })
    expect(c.hasProblem).toBe(true)
    const [req] = await records()
    expect(req).toMatchObject({ status: 'solicitada', checklistId: c.id, problem: 'Pneus: traseiro furado' })
    expect(c.requestId).toBe(req.id)
    const done = await recordMaintenance(db, farm.id, { equipmentId: jd.id, planId: null, kind: 'Conserto do pneu', date: today, meter: null, responsibleId: null, parts: [], serviceCents: 8000, notes: '' }, undefined, { requestId: req.id })
    expect(done).toMatchObject({ id: req.id, status: 'concluida', problem: 'Pneus: traseiro furado' })
    expect(await db.maintenanceRecords.count()).toBe(1)
    // envio repetido não duplica nem altera a manutenção concluída
    const again = await recordMaintenance(db, farm.id, { equipmentId: jd.id, planId: null, kind: 'x', date: today, meter: null, responsibleId: null, parts: [], serviceCents: 0, notes: '' }, undefined, { requestId: req.id })
    expect(again).toMatchObject({ kind: 'Conserto do pneu', serviceCents: 8000 })
    expect(await db.maintenanceRecords.count()).toBe(1)
    await expect(recordMaintenance(db, farm.id, { equipmentId: jd.id, planId: null, kind: 'x', date: today, meter: null, responsibleId: null, parts: [], serviceCents: 0, notes: '' }, undefined, { requestId: 'nao-existe' })).rejects.toBeInstanceOf(MaintenanceError)
  })
})

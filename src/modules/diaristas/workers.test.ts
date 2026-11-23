import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { cancelOperation, createOperation, type OperationInput } from '../manejo/operations'
import { createPasture } from '../pastos/pastures'
import { computeIndicators } from '../dashboard/dashboard'
import { buildReports } from '../relatorios/reports'
import { applyCurrentRate, clearDay, createWorker, dayState, defaultKind, markDay, monthSummary, outdatedDays, recordWorkerPayment, reverseWorkerPayment, updateWorker, WorkerError, workerBalance, workDayId } from './workers'

let db: ArgoDatabase
afterEach(async () => db?.delete())
const MONTH = '2026-10' // outubro/2026: 1º é quinta-feira (mês passado: nada é futuro)
const days = Array.from({ length: 31 }, (_, i) => `${MONTH}-${String(i + 1).padStart(2, '0')}`)
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
  const w = await createWorker(db, farm.id, { name: 'João da Silva', dailyCents: 10000, halfCents: null, halfReason: '', startDate: `${MONTH}-01`, notes: '' })
  const all = async () => ({ days: await db.workDays.toArray(), pays: await db.workerPayments.toArray() })
  return { farm, w, all }
}

describe('calendário de diárias', () => {
  it('regras: seg–sex integral, sábado meia, domingo sem expediente; passado sem marca = não trabalhou; futuro neutro', async () => {
    const { w } = await setup()
    expect(defaultKind('2026-10-05')).toBe('integral') // segunda
    expect(defaultKind('2026-10-03')).toBe('meia') // sábado
    expect(dayState(w, '2026-10-04', undefined, '2026-11-21')).toBe('domingo')
    expect(dayState(w, '2026-10-05', undefined, '2026-11-21')).toBe('nao-marcado')
    expect(dayState(w, '2026-12-01', undefined, '2026-11-21')).toBe('futuro')
    expect(dayState(w, '2026-11-21', undefined, '2026-11-21')).toBe('futuro') // hoje ainda não é falta
    expect(dayState(w, '2026-09-30', undefined, '2026-11-21')).toBe('antes')
    await expect(markDay(db, w.farmId, w.id, '2099-01-01', 'integral')).rejects.toThrow('futura')
  })

  it('20 integrais + 4 meias = R$ 2.200; faltas; pagamento parcial e saldo', async () => {
    const { farm, w, all } = await setup()
    const weekdays = days.filter((d) => dow(d) >= 1 && dow(d) <= 5)
    const saturdays = days.filter((d) => dow(d) === 6)
    for (const d of weekdays.slice(0, 20)) await markDay(db, farm.id, w.id, d, 'integral')
    for (const d of saturdays.slice(0, 4)) await markDay(db, farm.id, w.id, d, 'meia')
    let { days: wd, pays } = await all()
    const m = monthSummary(w, wd, pays, MONTH, '2026-11-21')
    expect(m).toMatchObject({ integral: 20, half: 4, daysWorked: 24, dueCents: 220000, paidCents: 0, balanceCents: 220000 })
    expect(m.absences).toBe(weekdays.length - 20 + saturdays.length - 4) // dias úteis sem marca (domingos não contam)
    await recordWorkerPayment(db, farm.id, { workerId: w.id, date: '2026-11-05', amountCents: 150000, method: 'Pix', refMonth: MONTH, notes: '' })
    ;({ days: wd, pays } = await all())
    expect(monthSummary(w, wd, pays, MONTH, '2026-11-21')).toMatchObject({ paidCents: 150000, balanceCents: 70000 })
    expect(workerBalance(w, wd, pays)).toEqual({ dueCents: 220000, paidCents: 150000, balanceCents: 70000 })
    // estorno de pagamento volta o saldo
    await reverseWorkerPayment(db, pays[0].id, 'lançado em dobro')
    ;({ days: wd, pays } = await all())
    expect(monthSummary(w, wd, pays, MONTH, '2026-11-21').balanceCents).toBe(220000)
  })

  it('alterar marcação: um registro por dia (sem duplicar), com histórico; meia diária com ajuste autorizado', async () => {
    const { farm, w } = await setup()
    await markDay(db, farm.id, w.id, '2026-10-05', 'integral')
    await markDay(db, farm.id, w.id, '2026-10-05', 'falta-justificada', 'médico')
    await markDay(db, farm.id, w.id, '2026-10-05', 'integral')
    expect(await db.workDays.count()).toBe(1)
    expect((await db.auditLog.where('[entity+entityId]').equals(['workDays', workDayId(w.id, '2026-10-05')]).count()) >= 3).toBe(true)
    await clearDay(db, w.id, '2026-10-05')
    expect((await db.workDays.get(workDayId(w.id, '2026-10-05')))?.deletedAt).not.toBeNull()
    await expect(createWorker(db, farm.id, { name: 'Pedro', dailyCents: 10000, halfCents: 6000, halfReason: '', startDate: MONTH + '-01', notes: '' })).rejects.toBeInstanceOf(WorkerError)
    const p = await createWorker(db, farm.id, { name: 'Pedro', dailyCents: 10000, halfCents: 6000, halfReason: 'combinado: sábado até 13h', startDate: MONTH + '-01', notes: '' })
    expect((await markDay(db, farm.id, p.id, '2026-10-03', 'meia')).valueCents).toBe(6000)
  })

  it('diária vinculada à operação sem duplicar custo; pagamento é a despesa (não a operação)', async () => {
    const { farm, w } = await setup()
    const pasto = await createPasture(db, farm.id, { name: 'Pasto da Chapada', areaHa: 20, notes: '' })
    await markDay(db, farm.id, w.id, '2026-10-06', 'integral')
    const base: OperationInput = { type: 'limpeza', date: '2026-10-06', pastureId: pasto.id, workedAreaCentiHa: 500, responsibleId: null, products: [], equipments: [], otherCosts: [], notes: '', workers: [{ workerId: w.id, kind: 'integral' }] }
    const op = await createOperation(db, farm.id, base)
    expect(op).toMatchObject({ laborCents: 10000, totalCents: 10000 })
    expect(await db.workDays.count()).toBe(1) // não criou segunda diária
    await expect(createOperation(db, farm.id, base)).rejects.toThrow('já está em outra operação')
    // dia ainda não marcado: a operação marca no calendário
    const op2 = await createOperation(db, farm.id, { ...base, date: '2026-10-07', workers: [{ workerId: w.id, kind: 'meia' }] })
    expect((await db.workDays.get(workDayId(w.id, '2026-10-07')))).toMatchObject({ kind: 'meia', valueCents: 5000, operationId: op2.id })
    await expect(markDay(db, farm.id, w.id, '2026-10-07', 'folga')).rejects.toThrow('operação de campo')
    await cancelOperation(db, op2.id, 'errada')
    expect((await db.workDays.get(workDayId(w.id, '2026-10-07')))?.operationId).toBeNull()
    // financeiro: só o pagamento é despesa
    await recordWorkerPayment(db, farm.id, { workerId: w.id, date: '2026-11-05', amountCents: 15000, method: 'Pix', refMonth: MONTH, notes: '' })
    const ind = computeIndicators({ farm: (await db.farms.get(farm.id))!, pastures: [], movements: [], sales: [], payments: [], clients: [], reserveEntries: [], supplies: [], supplyMovements: [], fuelMovements: [], equipments: [], tasks: [], audit: [], workerPayments: await db.workerPayments.toArray() }, '2026-11-21')
    expect(ind.workerExpenseCents).toBe(15000)
    expect(ind.expensesMonthCents).toBe(15000)
  })
})

describe('relatório de diaristas', () => {
  it('mês: devido, pago e saldo por trabalhador', async () => {
    const { farm, w } = await setup()
    await markDay(db, farm.id, w.id, '2026-10-05', 'integral')
    await markDay(db, farm.id, w.id, '2026-10-03', 'meia')
    await recordWorkerPayment(db, farm.id, { workerId: w.id, date: '2026-10-31', amountCents: 10000, method: 'Pix', refMonth: MONTH, notes: '' })
    const [r] = buildReports(['diaristas'], { farm: (await db.farms.get(farm.id))!, pastures: [], movements: [], sales: [], payments: [], clients: [], reserveEntries: [], workers: await db.workers.toArray(), workDays: await db.workDays.toArray(), workerPayments: await db.workerPayments.toArray(), today: '2026-11-21' }, { kind: 'mes', year: 2026, month: 10 })
    const row = r.tables[0].rows[0].map((x) => x.replace(/\u00a0/g, ' '))
    expect(row.slice(0, 4)).toEqual(['João da Silva', '2', '1', '1'])
    expect(row.slice(6)).toEqual(['R$ 150,00', 'R$ 100,00', 'R$ 50,00'])
    expect(r.tables[1].rows).toHaveLength(1)
  })
})

describe('diária alterada depois de marcar os dias', () => {
  it('mostra os dias com valor antigo e passa para o valor atual só quando pedido', async () => {
    const { farm, w, all } = await setup()
    await markDay(db, farm.id, w.id, '2026-10-05', 'integral') // R$ 100
    await markDay(db, farm.id, w.id, '2026-10-10', 'meia') // R$ 50
    await updateWorker(db, w.id, { name: w.name, dailyCents: 15000, halfCents: null, halfReason: '', startDate: w.startDate, notes: '' })
    await markDay(db, farm.id, w.id, '2026-10-06', 'integral') // já no valor novo: R$ 150
    const w2 = (await db.workers.get(w.id))!
    let d = await all()
    expect(workerBalance(w2, d.days, d.pays).balanceCents).toBe(10000 + 5000 + 15000) // nada muda sozinho
    expect(outdatedDays(w2, d.days).map((x) => x.date).sort()).toEqual(['2026-10-05', '2026-10-10'])
    expect(await applyCurrentRate(db, w.id)).toBe(2)
    d = await all()
    expect(workerBalance(w2, d.days, d.pays).balanceCents).toBe(15000 + 7500 + 15000)
    expect(outdatedDays(w2, d.days)).toHaveLength(0)
    const hist = await db.auditLog.where('[entity+entityId]').equals(['workDays', workDayId(w.id, '2026-10-05')]).toArray()
    expect(hist.length).toBeGreaterThanOrEqual(2) // a correção fica no histórico
  })
})

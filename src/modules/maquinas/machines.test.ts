import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createEquipment, recordFuelMovement, updateEquipment } from '../diesel/fuel'
import { createFarm } from '../fazendas/farms'
import { cancelOperation, createOperation, type OperationInput } from '../manejo/operations'
import { createPasture } from '../pastos/pastures'
import { todayLocal } from '../rebanho/herd'
import { createResponsible } from '../responsaveis/responsibles'
import { buildReports } from '../relatorios/reports'
import { adjustMeter, adjustSessionTime, endSession, loadMeterContext, MachineError, meterAt, pauseSession, resumeSession, sessionSeconds, startService } from './machines'

let db: ArgoDatabase
afterEach(async () => db?.delete())
// horários de amanhã: sempre depois do cadastro (horímetro inicial gravado agora)
const D = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const T = (hhmm: string) => `${D}T${hhmm}:00.000Z`

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
  const pasto = await createPasture(db, farm.id, { name: 'Pasto da Chapada', areaHa: 30, notes: '' })
  const ze = await createResponsible(db, farm.id, 'Zé', '')
  const jd = await createEquipment(db, farm.id, { name: 'John Deere 7230J', type: 'Trator', identification: 'SN-1', responsibleId: ze.id, meter: 'horimetro', brand: 'John Deere', model: '7230J', year: 2014, meterInitial: 124850 })
  const mf = await createEquipment(db, farm.id, { name: 'MF 275', type: 'Trator', identification: '', responsibleId: null, meter: 'horimetro', meterInitial: 50000 })
  const meter = async (id: string) => meterAt((await db.equipments.get(id))!, await loadMeterContext(db, farm.id))
  const svc = (ids: string[], now: string) => startService(db, farm.id, { serviceType: 'rocada', customType: '', pastureId: pasto.id, location: '', machines: ids.map((equipmentId) => ({ equipmentId, responsibleId: null })), notes: '' }, undefined, now)
  const sessions = async (serviceId: string) => db.machineSessions.where('serviceId').equals(serviceId).toArray()
  return { farm, pasto, ze, jd, mf, meter, svc, sessions }
}

describe('horímetro digital', () => {
  it('3 h 25 min a partir de 1.248,5 h → 1.251,92 h', async () => {
    const { jd, meter, svc, sessions } = await setup()
    expect(await meter(jd.id)).toBe(124850)
    const id = await svc([jd.id], T('07:00'))
    const [s] = await sessions(id)
    expect(sessionSeconds(s, T('08:00'))).toBe(3600) // tempo decorrido sem cronômetro rodando
    const done = await endSession(db, s.id, T('10:25'))
    expect(done.workedSeconds).toBe(3 * 3600 + 25 * 60)
    expect(await meter(jd.id)).toBe(125192)
    await expect(endSession(db, s.id, T('11:00'))).rejects.toThrow('já foi encerrado')
    expect(await meter(jd.id)).toBe(125192) // não conta duas vezes
  })

  it('pausa não conta; várias máquinas com horas independentes', async () => {
    const { jd, mf, meter, svc, sessions } = await setup()
    const id = await svc([jd.id, mf.id], T('07:00'))
    const [a, b] = (await sessions(id)).sort((x, y) => (x.equipmentId === jd.id ? -1 : 1) - (y.equipmentId === jd.id ? -1 : 1))
    await pauseSession(db, a.id, T('09:00'))
    await resumeSession(db, a.id, T('10:00'))
    await endSession(db, a.id, T('12:00')) // 5 h − 1 h pausa = 4 h
    await endSession(db, b.id, T('08:30')) // 1,5 h
    expect((await db.machineSessions.get(a.id))?.workedSeconds).toBe(4 * 3600)
    expect(await meter(jd.id)).toBe(124850 + 400)
    expect(await meter(mf.id)).toBe(50000 + 150)
  })

  it('não deixa a mesma máquina em dois serviços ao mesmo tempo nem usar máquina em manutenção', async () => {
    const { farm, jd, svc } = await setup()
    await svc([jd.id], T('07:00'))
    await expect(svc([jd.id], T('08:00'))).rejects.toThrow('já está em outro serviço')
    const mf2 = await createEquipment(db, farm.id, { name: 'Roçadeira', type: '', identification: '', responsibleId: null, meter: 'nenhum', status: 'manutencao' })
    await expect(svc([mf2.id], T('08:00'))).rejects.toBeInstanceOf(MachineError)
  })

  it('ajuste autorizado do tempo e do horímetro, com motivo', async () => {
    const { farm, jd, meter, svc, sessions } = await setup()
    const id = await svc([jd.id], T('07:00'))
    const [s] = await sessions(id)
    await endSession(db, s.id, T('18:00')) // esqueceu de encerrar
    await expect(adjustSessionTime(db, s.id, 4 * 3600, ' ')).rejects.toThrow('motivo')
    await adjustSessionTime(db, s.id, 4 * 3600, 'esqueceu de encerrar ao meio-dia')
    expect(await meter(jd.id)).toBe(124850 + 400)
    await adjustMeter(db, farm.id, jd.id, 130000, 'painel trocado', T('19:00'))
    expect(await meter(jd.id)).toBe(130000)
  })

  it('horímetro inicial só muda antes do primeiro uso', async () => {
    const { jd, svc, sessions } = await setup()
    const e = (await db.equipments.get(jd.id))!
    const id = await svc([jd.id], T('07:00'))
    await endSession(db, (await sessions(id))[0].id, T('08:00'))
    await expect(updateEquipment(db, e, { name: e.name, type: e.type, identification: e.identification, responsibleId: e.responsibleId, meter: 'horimetro', meterInitial: 100000 })).rejects.toThrow('Ajustar horímetro')
  })
})

describe('integração com a operação de campo', () => {
  it('horas vão para a operação sem digitar; uma sessão em uma operação só; diesel com leitura do horímetro digital', async () => {
    const { farm, pasto, jd, meter, svc, sessions } = await setup()
    await recordFuelMovement(db, farm.id, { type: 'compra', date: todayLocal(), centiliters: 50000, totalCents: 300000, station: 'Posto' })
    const id = await svc([jd.id], T('07:00'))
    const [s] = await sessions(id)
    const base: OperationInput = { type: 'rocada', date: todayLocal(), pastureId: pasto.id, workedAreaCentiHa: 1000, responsibleId: null, products: [], equipments: [{ equipmentId: jd.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: null, dieselCl: 4000, sessionId: s.id }], otherCosts: [], notes: '' }
    await expect(createOperation(db, farm.id, base)).rejects.toThrow('Encerre o serviço')
    await endSession(db, s.id, T('10:25'))
    const op = await createOperation(db, farm.id, base)
    expect(op.equipments[0]).toMatchObject({ sessionSeconds: 12300, hoursTenths: 34, meterStart: 12485, meterEnd: 12519 })
    expect((await db.machineSessions.get(s.id))?.operationId).toBe(op.id)
    expect(await meter(jd.id)).toBe(125192) // a leitura do diesel não soma de novo
    const fm = (await db.fuelMovements.toArray()).find((f) => f.operationId === op.id)!
    expect(fm).toMatchObject({ meterReading: 12519, meterFromSession: true })
    await expect(createOperation(db, farm.id, base)).rejects.toThrow('já estão em outra operação')
    // cancelar libera a sessão (as horas continuam no horímetro: a máquina trabalhou)
    await cancelOperation(db, op.id, 'lançada errada')
    expect((await db.machineSessions.get(s.id))?.operationId).toBeNull()
    expect(await meter(jd.id)).toBe(125192)
    const op2 = await createOperation(db, farm.id, base)
    expect(op2.equipments[0].sessionId).toBe(s.id)
  })

  it('transporte fora de pasto: local obrigatório, sem custo de pasto', async () => {
    const { farm, jd } = await setup()
    const base: OperationInput = { type: 'transporte', date: todayLocal(), pastureId: '', workedAreaCentiHa: 0, responsibleId: null, products: [], equipments: [{ equipmentId: jd.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: 20, dieselCl: 0 }], otherCosts: [], notes: '' }
    await expect(createOperation(db, farm.id, base)).rejects.toThrow('local')
    const op = await createOperation(db, farm.id, { ...base, location: 'Sede → Redenção' })
    expect(op).toMatchObject({ pastureId: '', location: 'Sede → Redenção' })
    await expect(createOperation(db, farm.id, { ...base, type: 'rocada', location: 'x' })).rejects.toThrow('Escolha o pasto')
  })
})

describe('relatório de máquinas', () => {
  it('horas por equipamento sem contar a sessão duas vezes (sessão + operação)', async () => {
    const { farm, pasto, jd, svc, sessions } = await setup()
    const id = await svc([jd.id], T('07:00'))
    const [s] = await sessions(id)
    await endSession(db, s.id, T('10:00'))
    await createOperation(db, farm.id, { type: 'rocada', date: todayLocal(), pastureId: pasto.id, workedAreaCentiHa: 500, responsibleId: null, products: [], equipments: [{ equipmentId: jd.id, responsibleId: null, meterStart: null, meterEnd: null, hoursTenths: null, dieselCl: 0, sessionId: s.id }], otherCosts: [], notes: '' })
    const y = Number(T('07:00').slice(0, 4))
    const [r] = buildReports(['maquinas'], { farm: (await db.farms.get(farm.id))!, pastures: [], movements: [], sales: [], payments: [], clients: [], reserveEntries: [], equipments: await db.equipments.toArray(), machineSessions: await db.machineSessions.toArray(), fieldOperations: await db.fieldOperations.toArray(), fuelMovements: [], maintenanceRecords: [], maintenancePlans: [], meterAdjustments: [] }, { kind: 'ano', year: y })
    expect(r.summary[0].value).toBe('3 h 00 min')
    expect(r.tables[0].rows.find((x) => x[0] === 'John Deere 7230J')?.[1]).toBe('3 h 00 min')
  })
})

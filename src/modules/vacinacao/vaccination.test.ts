import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { todayLocal } from '../rebanho/herd'
import { createResponsible } from '../responsaveis/responsibles'
import { addDays } from '../vendas/sales'
import { addApplication, coverage, createVaccination, reverseApplication, updateVaccination, VaccinationError, type VaccinationInput } from './vaccination'

let db: ArgoDatabase
afterEach(async () => db?.delete())
const today = todayLocal()

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
  const pasture = await createPasture(db, farm.id, { name: 'Pasto Grande', areaHa: null, notes: '' })
  const ze = await createResponsible(db, farm.id, 'Zé', 'vaqueiro')
  const input: VaccinationInput = { pastureId: pasture.id, lot: 'Bezerras', vaccine: 'Brucelose', product: 'B19', plannedQty: 50, responsibleId: ze.id, nextDate: null, notes: '' }
  const cov = async (id: string) => coverage((await db.vaccinations.get(id))!, await db.vaccinationApplications.toArray())
  return { farm, pasture, ze, input, cov }
}

describe('vacinação', () => {
  it('parcial: 50 no lote, 30 vacinados → 20 pendentes, 60%', async () => {
    const { farm, input, cov } = await setup()
    const v = await createVaccination(db, farm.id, input, { date: today, quantity: 30, responsibleId: null, notes: '' })
    expect(await cov(v.id)).toEqual({ planned: 50, vaccinated: 30, pending: 20, percent: 60, status: 'parcial' })
    const apps = await db.vaccinationApplications.toArray()
    expect(apps[0].responsibleId).toBe(input.responsibleId) // herda o responsável da campanha
  })

  it('várias aplicações atualizam a cobertura sem apagar as anteriores', async () => {
    const { farm, input, cov } = await setup()
    const v = await createVaccination(db, farm.id, input, { date: addDays(today, -3), quantity: 30, responsibleId: null, notes: '' })
    await addApplication(db, v.id, { date: today, quantity: 15, responsibleId: null, notes: 'faltaram 5 no curral' })
    expect((await cov(v.id)).pending).toBe(5)
    await addApplication(db, v.id, { date: today, quantity: 5, responsibleId: null, notes: '' })
    expect(await cov(v.id)).toMatchObject({ vaccinated: 50, pending: 0, percent: 100, status: 'completa' })
    expect(await db.vaccinationApplications.count()).toBe(3)
  })

  it('não vacina mais que os pendentes (pendente nunca vira vacinado sem aplicação)', async () => {
    const { farm, input, cov } = await setup()
    const v = await createVaccination(db, farm.id, input, { date: today, quantity: 30, responsibleId: null, notes: '' })
    await expect(addApplication(db, v.id, { date: today, quantity: 21, responsibleId: null, notes: '' })).rejects.toThrow('Só faltam 20')
    await expect(createVaccination(db, farm.id, { ...input, lot: 'Outro' }, { date: today, quantity: 51, responsibleId: null, notes: '' })).rejects.toThrow('Só faltam 50')
    expect((await cov(v.id)).vaccinated).toBe(30)
  })

  it('campanha sem aplicação começa "não iniciada" com 0%', async () => {
    const { farm, input, cov } = await setup()
    const v = await createVaccination(db, farm.id, input, null)
    expect(await cov(v.id)).toMatchObject({ vaccinated: 0, pending: 50, percent: 0, status: 'nao-iniciada' })
  })

  it('próxima vacinação é opcional e deve ser depois da aplicação', async () => {
    const { farm, input } = await setup()
    await expect(createVaccination(db, farm.id, { ...input, nextDate: today }, { date: today, quantity: 1, responsibleId: null, notes: '' })).rejects.toThrow('depois')
    const v = await createVaccination(db, farm.id, { ...input, nextDate: addDays(today, 180) }, { date: today, quantity: 1, responsibleId: null, notes: '' })
    expect(v.nextDate).toBe(addDays(today, 180))
  })

  it('estorno devolve os animais para pendentes e fica no histórico', async () => {
    const { farm, input, cov } = await setup()
    const v = await createVaccination(db, farm.id, input, { date: today, quantity: 30, responsibleId: null, notes: '' })
    const a = await addApplication(db, v.id, { date: today, quantity: 10, responsibleId: null, notes: '' })
    await reverseApplication(db, a.id, 'contado duas vezes')
    expect((await cov(v.id)).vaccinated).toBe(30)
    expect((await db.vaccinationApplications.get(a.id))?.status).toBe('estornado')
    await expect(reverseApplication(db, a.id, 'x')).rejects.toThrow('já foi estornada')
  })

  it('quantidade prevista pode aumentar, mas não ficar abaixo do vacinado', async () => {
    const { farm, input, cov } = await setup()
    const v = await createVaccination(db, farm.id, input, { date: today, quantity: 30, responsibleId: null, notes: '' })
    await expect(updateVaccination(db, v.id, { ...input, plannedQty: 29 })).rejects.toThrow('não pode ser menor')
    await updateVaccination(db, v.id, { ...input, plannedQty: 55 })
    expect((await cov(v.id)).pending).toBe(25)
  })

  it('não duplica: mesmo lote e vacina em andamento, e mesmo envio duas vezes', async () => {
    const { farm, input } = await setup()
    const key = newId()
    await createVaccination(db, farm.id, input, { date: today, quantity: 30, responsibleId: null, notes: '' }, key)
    await createVaccination(db, farm.id, input, { date: today, quantity: 30, responsibleId: null, notes: '' }, key)
    expect(await db.vaccinations.count()).toBe(1)
    expect(await db.vaccinationApplications.count()).toBe(1)
    await expect(createVaccination(db, farm.id, { ...input, lot: 'bezerras', vaccine: 'BRUCELOSE' }, null)).rejects.toBeInstanceOf(VaccinationError)
    await createVaccination(db, farm.id, { ...input, vaccine: 'Aftosa' }, null) // outra vacina: pode
  })

  it('campanha seguinte (reforço) marca a anterior', async () => {
    const { farm, input } = await setup()
    const v1 = await createVaccination(db, farm.id, { ...input, nextDate: addDays(today, 30) }, { date: addDays(today, -10), quantity: 50, responsibleId: null, notes: '' })
    const v2 = await createVaccination(db, farm.id, input, { date: today, quantity: 10, responsibleId: null, notes: '' }, undefined, v1.id)
    expect((await db.vaccinations.get(v1.id))?.followUpId).toBe(v2.id)
  })
})

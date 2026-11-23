import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { computeAgenda, computePendencies, type DashboardData } from '../dashboard/dashboard'
import { createFarm } from '../fazendas/farms'
import { addTask, createPasture, PastureError, setTaskDone } from '../pastos/pastures'
import { createResponsible } from '../responsaveis/responsibles'
import { addDaysIso, createTask, editTask, sortTasks, taskGroup } from './tasks'

let db: ArgoDatabase
afterEach(async () => db?.delete())
const today = '2026-11-23'

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'F', responsible: '', city: '' }, '')
  const pasto = await createPasture(db, farm.id, { name: 'Pasto A', areaHa: null, notes: '' })
  const ze = await createResponsible(db, farm.id, 'Zé', '')
  const base = { notes: '', pastureId: '', dueDate: null, responsibleId: null, priority: 'normal' as const }
  return { farm, pasto, ze, base }
}

describe('tarefas', () => {
  it('tarefa geral e de pasto na mesma lista; serviço antigo do pasto aparece', async () => {
    const { farm, pasto, base } = await setup()
    await addTask(db, pasto.id, 'Arrumar cerca') // serviço anotado no pasto (jeito antigo)
    await createTask(db, farm.id, { ...base, description: 'Comprar arame', dueDate: addDaysIso(today, 2) })
    await createTask(db, farm.id, { ...base, description: 'Limpar bebedouro', pastureId: pasto.id })
    const all = await db.pastureTasks.where('farmId').equals(farm.id).toArray()
    expect(all.map((t) => t.description).sort()).toEqual(['Arrumar cerca', 'Comprar arame', 'Limpar bebedouro'])
    await expect(createTask(db, farm.id, { ...base, description: '  ' })).rejects.toBeInstanceOf(PastureError)
  })

  it('grupos por prazo e ordem: atrasadas, hoje, semana, depois, sem prazo; alta primeiro', async () => {
    const { farm, base } = await setup()
    const mk = (description: string, dueDate: string | null, priority: 'normal' | 'alta' = 'normal') => createTask(db, farm.id, { ...base, description, dueDate, priority })
    await mk('sem prazo', null)
    await mk('depois', addDaysIso(today, 20))
    await mk('semana', addDaysIso(today, 3))
    await mk('hoje normal', today)
    await mk('hoje alta', today, 'alta')
    const late = await mk('atrasada', addDaysIso(today, -2))
    expect(taskGroup(late, today)).toBe('atrasadas')
    const sorted = sortTasks(await db.pastureTasks.toArray(), today).map((t) => t.description)
    expect(sorted).toEqual(['atrasada', 'hoje alta', 'hoje normal', 'semana', 'depois', 'sem prazo'])
    await setTaskDone(db, late.id, true)
    expect(taskGroup((await db.pastureTasks.get(late.id))!, today)).toBe('concluidas')
  })

  it('editar guarda histórico; Painel: atrasada na Central e na Agenda com responsável', async () => {
    const { farm, ze, base } = await setup()
    const t = await createTask(db, farm.id, { ...base, description: 'Vacinar bezerros', dueDate: addDaysIso(today, -1) })
    await editTask(db, t.id, { ...base, description: 'Vacinar bezerros (aftosa)', dueDate: addDaysIso(today, -1), responsibleId: ze.id, priority: 'alta' })
    const d = {
      farm: (await db.farms.get(farm.id))!,
      pastures: await db.pastures.toArray(),
      movements: [], sales: [], payments: [], clients: [], reserveEntries: [], supplies: [], supplyMovements: [], fuelMovements: [], equipments: [], audit: [],
      tasks: await db.pastureTasks.toArray(),
      responsibles: await db.responsibles.toArray(),
    } as DashboardData
    const p = computePendencies(d, today).find((x) => x.id === `tarefa:${t.id}`)!
    expect(p).toMatchObject({ priority: 1, title: 'Tarefa atrasada · Vacinar bezerros (aftosa)' })
    expect(p.detail).toContain('Zé')
    const a = computeAgenda(d, today).find((x) => x.id === `tarefa:${t.id}`)!
    expect(a).toMatchObject({ group: 'atrasadas', status: 'atrasada', responsible: 'Zé', date: addDaysIso(today, -1) })
    expect((await db.auditLog.where('[entity+entityId]').equals(['pastureTasks', t.id]).count()) >= 2).toBe(true)
  })
})

import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Responsible } from '../../db/types'

export class ResponsibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResponsibleError'
  }
}

function clean(name: string, role: string) {
  const n = name.trim().replace(/\s+/g, ' ')
  if (!n) throw new ResponsibleError('Informe o nome do responsável.')
  if (n.length > 60) throw new ResponsibleError('Nome muito longo (máx. 60 caracteres).')
  return { name: n, role: role.trim().slice(0, 40) }
}

async function assertUnique(db: ArgoDatabase, farmId: string, name: string, exceptId?: string) {
  const key = name.toLocaleLowerCase('pt-BR')
  const clash = (await db.responsibles.where('farmId').equals(farmId).toArray()).find(
    (r) => r.deletedAt === null && r.id !== exceptId && r.name.toLocaleLowerCase('pt-BR') === key,
  )
  if (clash) throw new ResponsibleError(`Já existe um responsável chamado "${clash.name}".`)
}

export async function createResponsible(db: ArgoDatabase, farmId: string, name: string, role: string, key?: string): Promise<Responsible> {
  const data = clean(name, role)
  return db.transaction('rw', [db.responsibles, db.auditLog, db.outbox, db.meta], async () => {
    if (key) {
      const existing = await db.responsibles.get(key)
      if (existing) return existing
    }
    await assertUnique(db, farmId, data.name)
    return new Repository(db, 'responsibles').create({ ...data, farmId, active: true }, key)
  })
}

export async function updateResponsible(db: ArgoDatabase, r: Responsible, name: string, role: string): Promise<Responsible> {
  const data = clean(name, role)
  return db.transaction('rw', [db.responsibles, db.auditLog, db.outbox, db.meta], async () => {
    await assertUnique(db, r.farmId, data.name, r.id)
    return new Repository(db, 'responsibles').update(r.id, data)
  })
}

/** Responsáveis não são apagados (os registros antigos continuam apontando para eles): são desativados. */
export async function setResponsibleActive(db: ArgoDatabase, id: string, active: boolean): Promise<Responsible> {
  return new Repository(db, 'responsibles').update(id, { active })
}

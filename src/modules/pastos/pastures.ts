import { nowIso } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { Pasture, PastureTask } from '../../db/types'
import { computeBalances, pastureTotal } from '../rebanho/herd'

export class PastureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PastureError'
  }
}

export interface PastureInput {
  name: string
  areaHa: number | null
  notes: string
}

/** Converte "12,5" / "12.5" / "" em número de hectares (ou null). */
export function parseArea(text: string): number | null {
  const raw = text.trim()
  // "1.234,5" (padrão BR) → 1234.5 ; "12.5" → 12.5
  const t = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) throw new PastureError('Área inválida. Use apenas números, ex.: 12,5')
  if (n > 1_000_000) throw new PastureError('Área muito alta. Confira o número.')
  return Math.round(n * 100) / 100
}

export function formatArea(ha: number | null): string {
  return ha === null ? '—' : `${ha.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`
}

function clean(input: PastureInput): PastureInput {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!name) throw new PastureError('Informe o nome do pasto.')
  if (name.length > 60) throw new PastureError('Nome muito longo (máx. 60 caracteres).')
  return { name, areaHa: input.areaHa, notes: input.notes.trim() }
}

async function assertUniqueName(db: ArgoDatabase, farmId: string, name: string, exceptId?: string) {
  const key = name.toLocaleLowerCase('pt-BR')
  const clash = (await db.pastures.where('farmId').equals(farmId).toArray()).find(
    (p) => p.deletedAt === null && p.id !== exceptId && p.name.toLocaleLowerCase('pt-BR') === key,
  )
  if (clash) throw new PastureError(`Já existe um pasto chamado "${clash.name}".`)
}

export async function createPasture(
  db: ArgoDatabase,
  farmId: string,
  input: PastureInput,
  idempotencyKey?: string,
): Promise<Pasture> {
  const repo = new Repository(db, 'pastures')
  const data = clean(input)
  return db.transaction('rw', [db.pastures, db.farms, db.auditLog, db.outbox, db.meta], async () => {
    if (idempotencyKey) {
      const existing = await db.pastures.get(idempotencyKey)
      if (existing) return existing
    }
    const farm = await db.farms.get(farmId)
    if (!farm || farm.deletedAt !== null) throw new PastureError('Fazenda não encontrada.')
    await assertUniqueName(db, farmId, data.name)
    return repo.create({ ...data, farmId }, idempotencyKey)
  })
}

export async function updatePasture(db: ArgoDatabase, id: string, input: PastureInput, expectedRev?: number): Promise<Pasture> {
  const repo = new Repository(db, 'pastures')
  const data = clean(input)
  return db.transaction('rw', [db.pastures, db.auditLog, db.outbox, db.meta], async () => {
    const current = await db.pastures.get(id)
    if (!current) throw new PastureError('Pasto não encontrado.')
    await assertUniqueName(db, current.farmId, data.name, id)
    return repo.update(id, data, expectedRev)
  })
}

/** Arquiva o pasto (exclusão lógica). Só é permitido com o pasto vazio. */
export async function archivePasture(db: ArgoDatabase, id: string): Promise<Pasture> {
  const repo = new Repository(db, 'pastures')
  return db.transaction('rw', [db.pastures, db.movements, db.auditLog, db.outbox, db.meta], async () => {
    const total = pastureTotal(computeBalances(await db.movements.toArray()), id)
    if (total !== 0) throw new PastureError(`O pasto ainda tem ${total} cabeça(s). Transfira os animais antes de arquivar.`)
    return repo.softDelete(id)
  })
}

// ------------------------------------------------------------------ serviços

export async function addTask(db: ArgoDatabase, pastureId: string, description: string, idempotencyKey?: string): Promise<PastureTask> {
  const text = description.trim()
  if (!text) throw new PastureError('Descreva o serviço.')
  if (text.length > 200) throw new PastureError('Descrição muito longa (máx. 200 caracteres).')
  const pasture = await db.pastures.get(pastureId)
  if (!pasture) throw new PastureError('Pasto não encontrado.')
  return new Repository(db, 'pastureTasks').create(
    { farmId: pasture.farmId, pastureId, description: text, done: false, doneAt: null },
    idempotencyKey,
  )
}

export async function setTaskDone(db: ArgoDatabase, id: string, done: boolean): Promise<PastureTask> {
  return new Repository(db, 'pastureTasks').update(id, { done, doneAt: done ? nowIso() : null })
}

export async function removeTask(db: ArgoDatabase, id: string): Promise<PastureTask> {
  return new Repository(db, 'pastureTasks').softDelete(id)
}

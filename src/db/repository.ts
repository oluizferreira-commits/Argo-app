import type { Table } from 'dexie'
import { newId, nowIso } from '../core/ids'
import type { ArgoDatabase } from './database'
import { getDeviceId } from './device'
import type { AuditAction, AuditEntry, BaseRecord, EntityInput, EntityMap, EntityName } from './types'

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/**
 * Repositório genérico. TODA gravação de dado de negócio passa por aqui, para que:
 *  1. o registro, o histórico (auditLog) e a fila de sincronização (outbox)
 *     sejam gravados na MESMA transação — ou tudo é salvo, ou nada;
 *  2. nenhum registro seja apagado fisicamente (exclusão lógica);
 *  3. criações sejam idempotentes (mesmo id = mesmo registro, sem duplicar).
 */
export class Repository<E extends EntityName> {
  private readonly db: ArgoDatabase
  readonly entity: E

  constructor(db: ArgoDatabase, entity: E) {
    this.db = db
    this.entity = entity
  }

  private get table(): Table<EntityMap[E], string> {
    return this.db[this.entity] as unknown as Table<EntityMap[E], string>
  }

  get(id: string): Promise<EntityMap[E] | undefined> {
    return this.table.get(id)
  }

  /** Registros ativos (não excluídos), mais recentes primeiro. */
  async listActive(): Promise<EntityMap[E][]> {
    const all = await this.table.orderBy('createdAt').reverse().toArray()
    return all.filter((r) => r.deletedAt === null)
  }

  /**
   * Cria um registro.
   * @param idempotencyKey id gerado quando o formulário é aberto. Se o mesmo
   *   formulário for enviado duas vezes (toque duplo, reenvio após falha),
   *   o registro existente é devolvido em vez de criar outro.
   */
  async create(input: EntityInput<E>, idempotencyKey?: string): Promise<EntityMap[E]> {
    const deviceId = await getDeviceId(this.db)
    return this.db.transaction('rw', [this.table, this.db.auditLog, this.db.outbox], async () => {
      const id = idempotencyKey ?? newId()
      const existing = await this.table.get(id)
      if (existing) return existing

      const at = nowIso()
      const base: BaseRecord = {
        id,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
        rev: 1,
        deviceId,
        syncStatus: 'pending',
      }
      const record = { ...input, ...base } as EntityMap[E]
      await this.table.add(record)
      await this.track('create', null, record, deviceId, at)
      return record
    })
  }

  /**
   * Altera um registro.
   * @param expectedRev se informado, recusa a alteração caso o registro tenha
   *   mudado desde que foi lido (evita sobrescrever alterações de outra tela).
   */
  async update(id: string, patch: Partial<EntityInput<E>>, expectedRev?: number): Promise<EntityMap[E]> {
    const deviceId = await getDeviceId(this.db)
    return this.db.transaction('rw', [this.table, this.db.auditLog, this.db.outbox], async () => {
      const before = await this.table.get(id)
      if (!before) throw new NotFoundError(`${this.entity}/${id} não encontrado`)
      if (expectedRev !== undefined && before.rev !== expectedRev) {
        throw new ConflictError('O registro foi alterado em outro lugar. Recarregue antes de salvar.')
      }
      const at = nowIso()
      const after = {
        ...before,
        ...stripBase(patch),
        updatedAt: at,
        rev: before.rev + 1,
        deviceId,
        syncStatus: 'pending',
      } as EntityMap[E]
      await this.table.put(after)
      await this.track('update', before, after, deviceId, at)
      return after
    })
  }

  /** Exclusão lógica: marca `deletedAt`; o registro e seu histórico permanecem. */
  softDelete(id: string): Promise<EntityMap[E]> {
    return this.setDeleted(id, true)
  }

  restore(id: string): Promise<EntityMap[E]> {
    return this.setDeleted(id, false)
  }

  /** Histórico completo de um registro, do mais antigo ao mais recente. */
  history(id: string): Promise<AuditEntry[]> {
    return this.db.auditLog.where('[entity+entityId]').equals([this.entity, id]).sortBy('at')
  }

  private async setDeleted(id: string, deleted: boolean): Promise<EntityMap[E]> {
    const deviceId = await getDeviceId(this.db)
    return this.db.transaction('rw', [this.table, this.db.auditLog, this.db.outbox], async () => {
      const before = await this.table.get(id)
      if (!before) throw new NotFoundError(`${this.entity}/${id} não encontrado`)
      if ((before.deletedAt !== null) === deleted) return before
      const at = nowIso()
      const after = {
        ...before,
        deletedAt: deleted ? at : null,
        updatedAt: at,
        rev: before.rev + 1,
        deviceId,
        syncStatus: 'pending',
      } as EntityMap[E]
      await this.table.put(after)
      await this.track(deleted ? 'delete' : 'restore', before, after, deviceId, at)
      return after
    })
  }

  private async track(
    action: AuditAction,
    before: EntityMap[E] | null,
    after: EntityMap[E],
    deviceId: string,
    at: string,
  ): Promise<void> {
    await this.db.auditLog.add({
      id: newId(),
      entity: this.entity,
      entityId: after.id,
      action,
      at,
      deviceId,
      rev: after.rev,
      before,
      after,
    })
    // Uma única entrada por registro na fila: a sincronização envia sempre o estado mais recente.
    const key = `${this.entity}:${after.id}`
    const queued = await this.db.outbox.get(key)
    await this.db.outbox.put({
      id: key,
      entity: this.entity,
      entityId: after.id,
      rev: after.rev,
      queuedAt: queued?.queuedAt ?? at,
      attempts: 0,
      lastError: null,
    })
  }
}

const BASE_KEYS: readonly (keyof BaseRecord)[] = ['id', 'createdAt', 'updatedAt', 'deletedAt', 'rev', 'deviceId', 'syncStatus']

/** Impede que um "patch" altere campos de controle (id, rev, datas...). */
function stripBase<T extends object>(patch: T): T {
  const copy = { ...patch } as Record<string, unknown>
  for (const k of BASE_KEYS) delete copy[k]
  return copy as T
}

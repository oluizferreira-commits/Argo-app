import Dexie, { type EntityTable, type Table } from 'dexie'
import type { AuditEntry, EntityMap, EntityName, MetaEntry, OutboxEntry } from './types'

export type ArgoDatabase = Dexie & {
  meta: EntityTable<MetaEntry, 'key'>
  auditLog: EntityTable<AuditEntry, 'id'>
  outbox: EntityTable<OutboxEntry, 'id'>
} & { [E in keyof EntityMap]: EntityTable<EntityMap[E], 'id'> }

export const DB_NAME = 'argo'

/**
 * REGRAS DE MIGRAÇÃO (preservação de dados):
 * - Nunca altere ou remova um `version(n)` já publicado.
 * - Para mudar o esquema, adicione `version(n + 1)` com as tabelas/índices novos
 *   e, se necessário, `.upgrade(tx => ...)` para converter os dados existentes.
 * - Índice com "&" = único (ex.: '&brinco' impede dois animais com o mesmo brinco).
 */
export function createDatabase(name = DB_NAME): ArgoDatabase {
  const db = new Dexie(name) as ArgoDatabase

  db.version(1).stores({
    meta: 'key',
    auditLog: 'id, [entity+entityId], at',
    outbox: 'id, queuedAt',
    diagnostics: 'id, createdAt, updatedAt',
  })

  // v2 — Etapa 2: pastos, serviços dos pastos e movimentações do rebanho.
  db.version(2).stores({
    pastures: 'id, createdAt, updatedAt, name',
    pastureTasks: 'id, pastureId, createdAt, updatedAt',
    movements: 'id, createdAt, updatedAt, date, type, *pastureIds',
  })

  return db
}

export const db = createDatabase()

/**
 * Acesso genérico a uma tabela de entidade (backup, sincronização).
 * Todas as entidades estendem BaseRecord, então a tabela é tratada como de BaseRecord.
 */
export function entityTable(db: ArgoDatabase, entity: EntityName): Table<EntityMap[EntityName], string> {
  return db[entity] as unknown as Table<EntityMap[EntityName], string>
}

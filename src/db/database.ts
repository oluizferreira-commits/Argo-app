import Dexie, { type EntityTable } from 'dexie'
import type { AuditEntry, EntityMap, MetaEntry, OutboxEntry } from './types'

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

  return db
}

export const db = createDatabase()

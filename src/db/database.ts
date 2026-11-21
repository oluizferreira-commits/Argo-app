import Dexie, { type EntityTable, type Table } from 'dexie'
import type { AuditEntry, CachedRoute, EntityMap, EntityName, MetaEntry, OutboxEntry } from './types'

export type ArgoDatabase = Dexie & {
  meta: EntityTable<MetaEntry, 'key'>
  auditLog: EntityTable<AuditEntry, 'id'>
  outbox: EntityTable<OutboxEntry, 'id'>
  routeCache: EntityTable<CachedRoute, 'id'>
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

  // v3 — várias fazendas: os dados passam a pertencer a uma fazenda (farmId).
  // Registros anteriores sem farmId são adotados pela primeira fazenda cadastrada.
  db.version(3).stores({
    farms: 'id, createdAt, updatedAt, name',
    pastures: 'id, createdAt, updatedAt, name, farmId',
    pastureTasks: 'id, pastureId, createdAt, updatedAt, farmId',
    movements: 'id, createdAt, updatedAt, date, type, *pastureIds, farmId',
  })

  // v4 — Etapa 3: clientes e vendas.
  db.version(4).stores({
    clients: 'id, farmId, createdAt, updatedAt, name',
    sales: 'id, farmId, createdAt, updatedAt, date, clientId, number',
  })

  // v5 — Como chegar: pontos de referência (dado de negócio) e cópia local das rotas calculadas.
  db.version(5).stores({
    landmarks: 'id, farmId, createdAt, updatedAt',
    routeCache: 'id, farmId',
  })

  // v6 — Etapa 4: recebimentos (contas a receber e pagamentos parciais).
  db.version(6).stores({
    payments: 'id, farmId, saleId, clientId, date, createdAt, updatedAt',
  })

  // v7 — Etapa 5: reserva financeira (depósitos e retiradas da conta separada).
  db.version(7).stores({
    reserveEntries: 'id, farmId, date, paymentId, createdAt, updatedAt',
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
